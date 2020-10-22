import sinon from 'sinon';
import { urls } from './config';
import { apiKey, MPConfig, testMPID } from './config';
import { MParticleWebSDK, SDKEvent, SDKProductActionType } from  '../../src/sdkRuntimeModels';
import * as dataPlan from './dataPlan.json';
import Utils from './utils';
import KitBlocker from '../../src/kitBlocking';
import Types from '../../src/types';
import should from 'should';

var forwarderDefaultConfiguration = Utils.forwarderDefaultConfiguration,
    MockForwarder = Utils.MockForwarder;

declare global {
    interface Window {
        mParticle: MParticleWebSDK;
        fetchMock: any;
        MockForwarder1: any;
    }
}

describe('kit blocking', () => {
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

        it('should mutate an event to null if the event name does not exist and blocking events is enabled', function(done) {
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

        it('should mutate EventsAttributes if an event attribute is not planned and blocking event attributes is enabled', function(done) {
            const event: SDKEvent = {
                DeviceId: 'test',
                IsFirstRun: true,
                EventName: 'locationEvent',
                EventCategory: Types.EventType.Location,
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
            mutatedEvent.EventAttributes.should.not.have.property('keyword2');
            mutatedEvent.EventAttributes.should.have.property('foo', 'hi');
    
            done();
        });

        it('should include EventsAttributes of unplanned attributes if blocked but additionalProperties is true', function(done) {
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

        it('block a custom event to forwarder based on data plan', function(done) {
            window.mParticle._resetForTests(MPConfig);

            var mockForwarder = new MockForwarder();
            window.mParticle.addForwarder(mockForwarder);
            window.mParticle.config.kitConfigs.push(forwarderDefaultConfiguration('MockForwarder'));
            window.mParticle.init(apiKey, window.mParticle.config);
    
            window.mParticle.logEvent('Test Event');

            var event = window.MockForwarder1.instance.receivedEvent;
            (event === null).should.equal(true);
            
            done();
        });

        it('should not block an unplanned custom event to forwarder is blok.ev=false', function(done) {
            window.mParticle._resetForTests(MPConfig);

            var mockForwarder = new MockForwarder();
            window.mParticle.addForwarder(mockForwarder);
            window.mParticle.config.kitConfigs.push(forwarderDefaultConfiguration('MockForwarder'));
            window.mParticle.config.dataPlan.document.dtpn.blok.ev = false;
            window.mParticle.init(apiKey, window.mParticle.config);
            
            window.mParticle.logEvent('Test Event');
            
            var event = window.MockForwarder1.instance.receivedEvent;
            event.should.have.property('EventName', 'Test Event');
            
            done();
        });

        it('should block any unplanned user attributes blok.ua = true', function(done) {
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

        it('should not block any unplanned user attributes blok.ua = false', function(done) {
            window.mParticle._resetForTests(MPConfig);
            window.mParticle.config.dataPlan.document.dtpn.blok.ua = false;
            window.mParticle.init(apiKey, window.mParticle.config);

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

            done();
        });

        it('should block any unplanned user identities when blok.ui = true', function(done) {
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
                UserAttributes: {
                    'my attribute': 'test1',
                    'my other attribute': 'test2',
                    'a third attribute': 'test3',
                    'unplanned attribute': 'test4',
                }
            }

            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateUserIdentities(event);

            mutatedEvent.UserIdentities.filter(UI => UI.Type === 1)[0].should.have.property('Identity', 'customerid1');
            mutatedEvent.UserIdentities.filter(UI => UI.Type === 7)[0].should.have.property('Identity', 'email@gmail.com');
            mutatedEvent.UserIdentities.filter(UI => UI.Type === 4)[0].should.have.property('Identity', 'GoogleId');

            done();
        });

        it('should block data when UI additional properties = false and blok.ui = true', function(done) {
            dataPlan.dtpn.vers.version_document.data_points[10].validator.definition.additionalProperties = false
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
                UserAttributes: {
                    'my attribute': 'test1',
                    'my other attribute': 'test2',
                    'a third attribute': 'test3',
                    'unplanned attribute': 'test4',
                }
            }

            var kitBlocker = new KitBlocker({document: dataPlan}, window.mParticle.getInstance());
            var mutatedEvent = kitBlocker.mutateUserIdentities(event);

            mutatedEvent.UserIdentities.filter(UI => UI.Type === 1)[0].should.have.property('Identity', 'customerid1');
            mutatedEvent.UserIdentities.filter(UI => UI.Type === 7)[0].should.have.property('Identity', 'email@gmail.com');
            mutatedEvent.UserIdentities.filter(UI => UI.Type === 4).length.should.equal(0);

            done();
        });
    })
}); 
