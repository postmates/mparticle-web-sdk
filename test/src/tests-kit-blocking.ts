import sinon from 'sinon';
import { urls } from './config';
import { apiKey, MPConfig, testMPID } from './config';
import { MParticleWebSDK, SDKEvent, SDKProductActionType } from  '../../src/sdkRuntimeModels';
import * as dataPlan from './dataPlan.json';
import Utils from './utils';
import KitBlocker from '../../src/kitBlocking';
import Types from '../../src/types';

var forwarderDefaultConfiguration = Utils.forwarderDefaultConfiguration,
    MockForwarder = Utils.MockForwarder;

declare global {
    interface Window {
        mParticle: MParticleWebSDK;
        fetchMock: any;
        MockForwarder1: any;
    }
}

describe.only('kit blocking', () => {
    var mockServer;

    beforeEach(function() {
        mockServer = sinon.createFakeServer();
        mockServer.respondImmediately = true;

        mockServer.respondWith(urls.identify, [
            200,
            {},
            JSON.stringify({ mpid: testMPID, is_logged_in: false }),
        ]);
    });
    
    afterEach(function() {
        mockServer.reset();
    });
    
    describe('batching via window.fetch', () => {
        beforeEach(function() {
            window.fetchMock.post(urls.eventsV3, 200);
            window.fetchMock.config.overwriteRoutes = true;
            window.mParticle.config.flags = {
                eventsV3: '100',
                eventBatchingIntervalMillis: 1000,
            }
            window.mParticle.config.dataPlan = {
                document: dataPlan
            };
            window.mParticle.config.kitConfigs = []
            
        });

        afterEach(function() {
            window.fetchMock.restore();
            sinon.restore();
        });

        it('kitBlocker should parse data plan into dataPlanMatchLookups properly', function(done) {
            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());

            kitBlocker.dataPlanMatchLookups.should.have.property('custom_event:search:Search Event', true);
            kitBlocker.dataPlanMatchLookups.should.have.property('custom_event:location:locationEvent', {foo: true, 'foo foo': true, 'foo number': true});
            kitBlocker.dataPlanMatchLookups.should.have.property('product_action:add_to_cart', {
                attributeNumMinMax: true,
                attributeEmail: true,
                attributeNumEnum: true,
                attributeStringAlpha: true,
                attributeBoolean: true,
            });
            kitBlocker.dataPlanMatchLookups.should.have.property('promotion_action:view', {
                'not required': true,
                'required': true
            });
            kitBlocker.dataPlanMatchLookups.should.have.property('custom_event:navigation:TestEvent', true);
            kitBlocker.dataPlanMatchLookups.should.have.property('product_impression:', {
                thing1: true
            });
            kitBlocker.dataPlanMatchLookups.should.have.property('screen_view::A New ScreenViewEvent', true)
            kitBlocker.dataPlanMatchLookups.should.have.property('screen_view::my screeeen', {
                test2key: true,
                test1key: true,
            });
            kitBlocker.dataPlanMatchLookups.should.have.property('custom_event:navigation:something something something', true);
            kitBlocker.dataPlanMatchLookups.should.have.property('user_attributes', {
                'my attribute': true,
                'my other attribute': true,
                'a third attribute': true,
            });
            kitBlocker.dataPlanMatchLookups.should.have.property('user_identities', true)
            
            done();
        });

        it('should mutate an unplanned event to null if blok.ev = true', function(done) {
            const event: SDKEvent = {
                DeviceId: 'test',
                IsFirstRun: true,
                EventName: 'unplanned event',
                EventCategory: Types.EventType.Search,
                MPID: testMPID, 
                EventAttributes: { keyword2: 'test' },
                SDKVersion: '1.0.0',
                SessionId: 'sessionId',
                SessionStartDate: 1,
                Timestamp: 1,
                EventDataType: Types.MessageType.PageEvent,
                Debug: true,
                CurrencyCode: 'usd',
            }
            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateEventAndEventAttributes(event);
            (mutatedEvent === null).should.equal(true);
    
            done();
        });

        it('should mutate EventAttributes if an event attribute is not planned and blok.ea = true', function(done) {
            const event: SDKEvent = {
                DeviceId: 'test',
                IsFirstRun: true,
                EventName: 'locationEvent',
                EventCategory: Types.EventType.Location,
                MPID: testMPID, 
                EventAttributes: { unplannedAttr: 'test', foo: 'hi' },
                SDKVersion: '1.0.0',
                SessionId: 'sessionId',
                SessionStartDate: 1,
                Timestamp: 1,
                EventDataType: Types.MessageType.PageEvent,
                Debug: true,
                CurrencyCode: 'usd',
            }
            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateEventAndEventAttributes(event);
            mutatedEvent.EventAttributes.should.not.have.property('unplannedAttr');
            mutatedEvent.EventAttributes.should.have.property('foo', 'hi');
    
            done();
        });

        it('should include unplanned event attributes if additionalProperties = true and blok.ea = true', function(done) {
            const event: SDKEvent = {
                DeviceId: 'test',
                IsFirstRun: true,
                EventName: 'something something something',
                EventCategory: Types.EventType.Navigation,
                MPID: testMPID, 
                EventAttributes: { keyword2: 'test', foo: 'hi' },
                SDKVersion: '1.0.0',
                SessionId: 'sessionId',
                SessionStartDate: 1,
                Timestamp: 1,
                EventDataType: Types.MessageType.PageEvent,
                Debug: true,
                CurrencyCode: 'usd',
            }
            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateEventAndEventAttributes(event);
            mutatedEvent.EventAttributes.should.have.property('foo', 'hi');
            mutatedEvent.EventAttributes.should.have.property('keyword2', 'test');
    
            done();
        });

        it('should block a custom event from reaching the forwarder if event is unplanned and block.ev=true', function(done) {
            window.mParticle._resetForTests(MPConfig);

            var mockForwarder = new MockForwarder();
            window.mParticle.addForwarder(mockForwarder);
            window.mParticle.config.kitConfigs.push(forwarderDefaultConfiguration('MockForwarder'));
            window.mParticle.init(apiKey, window.mParticle.config);
    
            window.mParticle.logEvent('Blocked event');

            var event = window.MockForwarder1.instance.receivedEvent;
            (event === null).should.equal(true);
            
            done();
        });

        it('should allow unplanned custom events through to forwarder if blok.ev=false', function(done) {
            window.mParticle._resetForTests(MPConfig);

            var mockForwarder = new MockForwarder();
            window.mParticle.addForwarder(mockForwarder);
            window.mParticle.config.kitConfigs.push(forwarderDefaultConfiguration('MockForwarder'));
            window.mParticle.config.dataPlan.document.dtpn.blok.ev = false;
            window.mParticle.init(apiKey, window.mParticle.config);
            
            window.mParticle.logEvent('Unplanned Event');
            
            var event = window.MockForwarder1.instance.receivedEvent;
            event.should.have.property('EventName', 'Unplanned Event');
            
            // reset
            window.mParticle.config.dataPlan.document.dtpn.blok.ev = true;
            
            done();
        });

        it('should block any unplanned event attributes if custom attributes is empty, additionalProperties = false, and block.ea = true.', function(done) {
            const event: SDKEvent = {
                DeviceId: 'test',
                IsFirstRun: true,
                EventName: 'SocialEvent',
                EventCategory: Types.EventType.Social,
                MPID: testMPID, 
                EventAttributes: { keyword2: 'test', foo: 'hi' },
                SDKVersion: '1.0.0',
                SessionId: 'sessionId',
                SessionStartDate: 1,
                Timestamp: 1,
                EventDataType: Types.MessageType.PageEvent,
                Debug: true,
                CurrencyCode: 'usd'
            }

            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateEventAndEventAttributes(event);
            Object.keys(mutatedEvent.EventAttributes).length.should.equal(0);

            done();
        });

        it('should block any unplanned user attributes when blok.ua = true and additionalPropertes = false', function(done) {
            const event: SDKEvent = {
                DeviceId: 'test',
                IsFirstRun: true,
                EventName: 'something something something',
                EventCategory: Types.EventType.Navigation,
                MPID: testMPID, 
                EventAttributes: { keyword2: 'test', foo: 'hi' },
                SDKVersion: '1.0.0',
                SessionId: 'sessionId',
                SessionStartDate: 1,
                Timestamp: 1,
                EventDataType: Types.MessageType.PageEvent,
                Debug: true,
                CurrencyCode: 'usd',
                UserAttributes: {
                    'my attribute': 'test1',
                    'my other attribute': 'test2',
                    'a third attribute': 'test3',
                    'unplanned attribute': 'test4',
                }
            }

            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateUserAttributes(event);
            mutatedEvent.UserAttributes.should.have.property('my attribute', 'test1');
            mutatedEvent.UserAttributes.should.have.property('my other attribute', 'test2');
            mutatedEvent.UserAttributes.should.have.property('a third attribute', 'test3');
            mutatedEvent.UserAttributes.should.not.have.property('unplanned attribute');

            done();
        });

        it('should not block any unplanned user attributes if blok.ua = false', function(done) {
            //TODO - what if this additional properties is false? shoudl we validate that?
            window.mParticle.config.dataPlan.document.dtpn.blok.ua = false;

            const event: SDKEvent = {
                DeviceId: 'test',
                IsFirstRun: true,
                EventName: 'something something something',
                EventCategory: Types.EventType.Navigation,
                MPID: testMPID, 
                EventAttributes: { keyword2: 'test', foo: 'hi' },
                SDKVersion: '1.0.0',
                SessionId: 'sessionId',
                SessionStartDate: 1,
                Timestamp: 1,
                EventDataType: Types.MessageType.PageEvent,
                Debug: true,
                CurrencyCode: 'usd',
                UserAttributes: {
                    'my attribute': 'test1',
                    'my other attribute': 'test2',
                    'a third attribute': 'test3',
                    'unplanned attribute': 'test4',
                }
            }

            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateUserAttributes(event);
            mutatedEvent.UserAttributes.should.have.property('my attribute', 'test1');
            mutatedEvent.UserAttributes.should.have.property('my other attribute', 'test2');
            mutatedEvent.UserAttributes.should.have.property('a third attribute', 'test3');
            mutatedEvent.UserAttributes.should.have.property('unplanned attribute', 'test4');
            
            //reset
            window.mParticle.config.dataPlan.document.dtpn.blok.ua = true;

            done();
        });

        it('should block an unplanned attribute from being set on the forwarder if additionalProperties = false and blok.ua = true', function(done) {
            window.mParticle._resetForTests(MPConfig);

            var mockForwarder = new MockForwarder();
            window.mParticle.addForwarder(mockForwarder);
            window.mParticle.config.kitConfigs.push(forwarderDefaultConfiguration('MockForwarder'));
            window.mParticle.init(apiKey, window.mParticle.config);

            window.mParticle.Identity.getCurrentUser().setUserAttribute('unplannedAttr', true);
            window.MockForwarder1.instance.should.have.property(
                'setUserAttributeCalled',
                false
            );

            done();
        });

        it('should allow an unplanned attribute to be set on forwarder if additionalProperties = true and blok.ua = true', function(done) {
            window.mParticle._resetForTests(MPConfig);

            var userAttributeDataPoint = dataPlan.dtpn.vers.version_document.data_points.find(dataPoint => {
                return dataPoint.match.type === 'user_attributes'
            });

            userAttributeDataPoint.validator.definition.additionalProperties = true;

            var mockForwarder = new MockForwarder();
            window.mParticle.addForwarder(mockForwarder);
            window.mParticle.config.kitConfigs.push(forwarderDefaultConfiguration('MockForwarder'));
            window.mParticle.init(apiKey, window.mParticle.config);

            debugger;
            window.mParticle.Identity.getCurrentUser().setUserAttribute('unplanned but unblocked', true);
            window.MockForwarder1.instance.should.have.property(
                'setUserAttributeCalled',
                true
            );

            userAttributeDataPoint.validator.definition.additionalProperties = false;
            
            done();
        });
    
        it('should allow an unplanned user attribute to be set on the forwarder if blok=false', function(done) {
            window.mParticle.config.dataPlan.document.dtpn.blok.ua = false
            window.mParticle._resetForTests(MPConfig);

            var mockForwarder = new MockForwarder();
            window.mParticle.addForwarder(mockForwarder);
            window.mParticle.config.kitConfigs.push(forwarderDefaultConfiguration('MockForwarder'));
            window.mParticle.init(apiKey, window.mParticle.config);
            window.mParticle.Identity.getCurrentUser().setUserAttribute('unplanned but not blocked', true);
            window.MockForwarder1.instance.should.have.property(
                'setUserAttributeCalled',
                true
            );

            window.mParticle.config.dataPlan.document.dtpn.blok.ua = true

            done();
        });

        it('should block an unplanned attribute set via setUserTag from being set on the forwarder if additionalProperties = false and blok.ua = true', function(done) {
            window.mParticle._resetForTests(MPConfig);

            var mockForwarder = new MockForwarder();
            window.mParticle.addForwarder(mockForwarder);
            window.mParticle.config.kitConfigs.push(forwarderDefaultConfiguration('MockForwarder'));
            window.mParticle.init(apiKey, window.mParticle.config);

            window.mParticle.Identity.getCurrentUser().setUserTag('unplannedAttr', true);
            window.MockForwarder1.instance.should.have.property(
                'setUserAttributeCalled',
                false
            );

            done();
        });

        it('should allow an unplanned attribute set via setUserTag to be set on forwarder if additionalProperties = true and blok.ua = true', function(done) {
            window.mParticle._resetForTests(MPConfig);

            var userAttributeDataPoint = dataPlan.dtpn.vers.version_document.data_points.find(dataPoint => {
                return dataPoint.match.type === 'user_attributes'
            });

            userAttributeDataPoint.validator.definition.additionalProperties = true;

            var mockForwarder = new MockForwarder();
            window.mParticle.addForwarder(mockForwarder);
            window.mParticle.config.kitConfigs.push(forwarderDefaultConfiguration('MockForwarder'));
            window.mParticle.init(apiKey, window.mParticle.config);

            debugger;
            window.mParticle.Identity.getCurrentUser().setUserTag('unplanned but unblocked', true);
            window.MockForwarder1.instance.should.have.property(
                'setUserAttributeCalled',
                true
            );

            userAttributeDataPoint.validator.definition.additionalProperties = false;
            
            done();
        });
    
        it('should allow an unplanned user attribute set via setUserTag to be set on the forwarder if blok=false', function(done) {
            window.mParticle.config.dataPlan.document.dtpn.blok.ua = false
            window.mParticle._resetForTests(MPConfig);

            var mockForwarder = new MockForwarder();
            window.mParticle.addForwarder(mockForwarder);
            window.mParticle.config.kitConfigs.push(forwarderDefaultConfiguration('MockForwarder'));
            window.mParticle.init(apiKey, window.mParticle.config);
            window.mParticle.Identity.getCurrentUser().setUserTag('unplanned but not blocked', true);
            window.MockForwarder1.instance.should.have.property(
                'setUserAttributeCalled',
                true
            );

            window.mParticle.config.dataPlan.document.dtpn.blok.ua = true

            done();
        });

        it('isAttributeKeyBlocked should return false for attributes that are blocked and true for properties that are not', function(done) {
            // this key is blocked because the default data plan has user_attributes>additional_properties = false
            const kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());

            let isBlocked = kitBlocker.isAttributeKeyBlocked('blocked');
            isBlocked.should.equal(true);

            var userAttributeDataPoint = dataPlan.dtpn.vers.version_document.data_points.find(dataPoint => {
                return dataPoint.match.type === 'user_attributes'
            });
            userAttributeDataPoint.validator.definition.additionalProperties = true;
                
            const kitBlocker2 = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            isBlocked = kitBlocker2.isAttributeKeyBlocked('my attribute');
            isBlocked.should.equal(false);

            // reset to original data plan
            userAttributeDataPoint.validator.definition.additionalProperties = false;

            done();
        });

        it('should not block any unplanned user identities when blok.ui = true and additionalProperties = true', function(done) {
            const event: SDKEvent = {
                DeviceId: 'test',
                IsFirstRun: true,
                EventName: 'something something something',
                EventCategory: Types.EventType.Navigation,
                MPID: testMPID, 
                EventAttributes: { keyword2: 'test', foo: 'hi' },
                SDKVersion: '1.0.0',
                SessionId: 'sessionId',
                SessionStartDate: 1,
                Timestamp: 1,
                EventDataType: Types.MessageType.PageEvent,
                UserIdentities: [
                    { Type: 7, Identity: 'email@gmail.com' },
                    { Type: 1, Identity: 'customerid1' },
                    { Type: 4, Identity: 'GoogleId' }
                ],
                Debug: true,
                CurrencyCode: 'usd'
            }

            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateUserIdentities(event);

            mutatedEvent.UserIdentities.filter(UI => UI.Type === 1)[0].should.have.property('Identity', 'customerid1');
            mutatedEvent.UserIdentities.filter(UI => UI.Type === 7)[0].should.have.property('Identity', 'email@gmail.com');
            mutatedEvent.UserIdentities.filter(UI => UI.Type === 4)[0].should.have.property('Identity', 'GoogleId');

            done();
        });

        it('should block UIs when additional properties = false and blok.ui = true', function(done) {
            var userIdentityDataPoint = dataPlan.dtpn.vers.version_document.data_points.find(dataPoint => {
                return dataPoint.match.type === 'user_identities'
            });

            userIdentityDataPoint.validator.definition.additionalProperties = false;

            const event: SDKEvent = {
                DeviceId: 'test',
                IsFirstRun: true,
                EventName: 'something something something',
                EventCategory: Types.EventType.Navigation,
                MPID: testMPID, 
                EventAttributes: { keyword2: 'test', foo: 'hi' },
                SDKVersion: '1.0.0',
                SessionId: 'sessionId',
                SessionStartDate: 1,
                Timestamp: 1,
                EventDataType: Types.MessageType.PageEvent,
                UserIdentities: [
                    { Type: 7, Identity: 'email@gmail.com' },
                    { Type: 1, Identity: 'customerid1' },
                    { Type: 4, Identity: 'GoogleId' }
                ],
                Debug: true,
                CurrencyCode: 'usd',
            }

            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateUserIdentities(event);

            mutatedEvent.UserIdentities.find(UI => UI.Type === 1).should.have.property('Identity', 'customerid1');
            mutatedEvent.UserIdentities.find(UI => UI.Type === 7).should.have.property('Identity', 'email@gmail.com');
            (mutatedEvent.UserIdentities.find(UI => UI.Type === 4) === undefined).should.equal(true);

            // reset
            userIdentityDataPoint.validator.definition.additionalProperties = true;

            done();
        });









        it('should mutate productAttributes if an event attribute is not planned and blok.ea = true', function(done) {
            const event: SDKEvent = {
                DeviceId: 'test',
                IsFirstRun: true,
                EventName: 'locationEvent',
                EventCategory: Types.CommerceEventType.Purchase,
                MPID: testMPID, 
                // EventAttributes: { unplannedAttr: 'test', foo: 'hi' }, //check these
                SDKVersion: '1.0.0',
                SessionId: 'sessionId',
                SessionStartDate: 1,
                Timestamp: 1,
                EventDataType: Types.MessageType.Commerce,
                Debug: true,
                CurrencyCode: 'usd',
                ProductAction: {
                    ProductActionType: SDKProductActionType.Purchase,
                    ProductList: [
                        {
                            Attributes: {
                                'plannedAttr1': 'val1',
                                'plannedAttr2': 'val2',
                                'unplannedAttr1': 'val3'
                            },
                            Name: 'iPhone',
                            Category: 'category',
                            CouponCode: 'coupon',
                            Position: 1,
                            Price: 999,
                            Quantity: 1,
                            Sku: 'iphoneSKU',
                            TotalAmount: 999,
                            Variant: '128',
                        },
                        {
                            Attributes: {
                                'plannedAttr1': 'val1',
                                'plannedAttr2': 'val2',
                                'unplannedAttr1': 'val3'
                            },
                            Name: 'S10',
                            Category: 'category',
                            CouponCode: 'coupon',
                            Position: 2,
                            Price: 500,
                            Quantity: 1,
                            Sku: 'galaxySKU',
                            TotalAmount: 500,
                            Variant: '256',
                        }
                    ]
                }
            }
            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateEventAndEventAttributes(event);
            
            mutatedEvent.ProductAction.ProductList[0].Attributes.should.not.have.property('unplannedAttr1');
            mutatedEvent.ProductAction.ProductList[0].Attributes.should.have.property('plannedAttr1');
            mutatedEvent.ProductAction.ProductList[0].Attributes.should.have.property('plannedAttr2');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Name', 'iPhone');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Category', 'category');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('CouponCode', "coupon");
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Position', 1);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Price', 999);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Quantity', 1);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Sku', 'iphoneSKU');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('TotalAmount', 999);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Variant', '128');

            mutatedEvent.ProductAction.ProductList[1].Attributes.should.not.have.property('unplannedAttr1');
            mutatedEvent.ProductAction.ProductList[1].Attributes.should.have.property('plannedAttr1');
            mutatedEvent.ProductAction.ProductList[1].Attributes.should.have.property('plannedAttr2');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Name', 'S10');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Category', 'category');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('CouponCode', 'coupon');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Position', 2);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Price', 500);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Quantity', 1);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Sku', 'galaxySKU');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('TotalAmount', 500);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Variant', '256');
    
            done();
        });

        it('should mutate productAttributes if an event attribute is not planned and blok.ea = true', function(done) {
            const event: SDKEvent = {
                DeviceId: 'test',
                IsFirstRun: true,
                EventName: 'locationEvent',
                EventCategory: Types.CommerceEventType.AddToCart,
                MPID: testMPID, 
                // EventAttributes: { unplannedAttr: 'test', foo: 'hi' }, //check these
                SDKVersion: '1.0.0',
                SessionId: 'sessionId',
                SessionStartDate: 1,
                Timestamp: 1,
                EventDataType: Types.MessageType.Commerce,
                Debug: true,
                CurrencyCode: 'usd',
                ProductAction: {
                    ProductActionType: SDKProductActionType.AddToCart,
                    ProductList: [
                        {
                            Attributes: {
                                'plannedAttr1': 'val1',
                                'plannedAttr2': 'val2',
                                'unplannedAttr1': 'val3'
                            },
                            Name: 'iPhone',
                            Category: 'category',
                            CouponCode: 'coupon',
                            Position: 1,
                            Price: 999,
                            Quantity: 1,
                            Sku: 'iphoneSKU',
                            TotalAmount: 999,
                            Variant: '128',
                        },
                        {
                            Attributes: {
                                'plannedAttr1': 'val1',
                                'plannedAttr2': 'val2',
                                'unplannedAttr1': 'val3'
                            },
                            Name: 'S10',
                            Category: 'category',
                            CouponCode: 'coupon',
                            Position: 2,
                            Price: 500,
                            Quantity: 1,
                            Sku: 'galaxySKU',
                            TotalAmount: 500,
                            Variant: '256',
                        }
                    ]
                }
            }
            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateEventAndEventAttributes(event);
            
            mutatedEvent.ProductAction.ProductList[0].Attributes.should.not.have.property('unplannedAttr1');
            mutatedEvent.ProductAction.ProductList[0].Attributes.should.have.property('plannedAttr1');
            mutatedEvent.ProductAction.ProductList[0].Attributes.should.have.property('plannedAttr2');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Name', 'iPhone');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Category', 'category');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('CouponCode', "coupon");
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Position', 1);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Price', 999);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Quantity', 1);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Sku', 'iphoneSKU');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('TotalAmount', 999);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Variant', '128');

            mutatedEvent.ProductAction.ProductList[1].Attributes.should.not.have.property('unplannedAttr1');
            mutatedEvent.ProductAction.ProductList[1].Attributes.should.have.property('plannedAttr1');
            mutatedEvent.ProductAction.ProductList[1].Attributes.should.have.property('plannedAttr2');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Name', 'S10');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Category', 'category');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('CouponCode', 'coupon');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Position', 2);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Price', 500);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Quantity', 1);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Sku', 'galaxySKU');
            mutatedEvent.ProductAction.ProductList[0].should.have.property('TotalAmount', 500);
            mutatedEvent.ProductAction.ProductList[0].should.have.property('Variant', '256');
    
            done();
        });
    })
}); 
