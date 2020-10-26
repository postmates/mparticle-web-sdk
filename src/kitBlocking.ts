import { convertEvent } from './sdkToEventsApiConverter';
import { SDKEvent, MParticleWebSDK } from './sdkRuntimeModels';
import { BaseEvent, EventTypeEnum } from '@mparticle/event-models';
import Types from './types'
import { DataPlanPoint } from '@mparticle/data-planning-models';

/*  
    TODO: Including this as a workaround because attempting to import it from
    @mparticle/data-planning-models directly creates a build error.
 */
let DataPlanMatchType = {
    ScreenView: "screen_view",
    CustomEvent: "custom_event",
    Commerce: "commerce",
    UserAttributes: "user_attributes",
    UserIdentities: "user_identities",
    ProductAction: "product_action",
    PromotionAction: "promotion_action",
    ProductImpression: "product_impression"
}

/*  
    inspiration from https://github.com/mParticle/data-planning-node/blob/master/src/data_planning/data_plan_event_validator.ts
    but modified to only include commerce events, custom events, screen views, and removes validation

    The purpose of the KitBlocker class is to parse a data plan and determine what events, event/user/product attributes, and user identities should be blocked from downstream forwarders.

    KitBlocker is instantiated with a data plan on mParticle initialization. KitBlocker.kitBlockingEnabled is false if no data plan is passed.
    It parses the data plan by creating a `dataPlanMatchLookups` object in the following manner:
        1. For all events and user attributes/identities, it generates a `matchKey` in the shape of `typeOfEvent:eventType:nameOfEvent`
            a. The matchKeys' value will return `true` if additionalProperties for the custom attributes/identities is `true`, otherwise it will return an object of planned attribute/identities
        2. For commerce events, after step 1 and 1a, a second `matchKey` is included that appends `Products`. This is used to determine productAttributes blocked
    
    When an event is logged in mParticle, it is sent to our server and then calls `KitBlocker.createBlockedEvent` before passing the event to each forwarder.
    If the event is blocked, it will not send to the forwarder. If the event is not blocked, event/user/product attributes and user identities will be removed/mutated if blocked.
*/
export default class KitBlocker {
    dataPlanMatchLookups: { [key: string]: {} } = {};
    blockEvents: Boolean = false;
    blockEventAttributes: Boolean = false;
    blockUserAttributes: Boolean = false;
    blockUserIdentities: Boolean = false;
    kitBlockingEnabled: Boolean = false;
    mpInstance: MParticleWebSDK;

    constructor(dataPlan: any, mpInstance: MParticleWebSDK) {
        this.mpInstance = mpInstance;
        this.kitBlockingEnabled = Boolean(dataPlan?.document?.dtpn?.blok)
        this.blockEvents = dataPlan?.document?.dtpn?.blok?.ev;
        this.blockEventAttributes = dataPlan?.document?.dtpn?.blok?.ea;
        this.blockUserAttributes = dataPlan?.document?.dtpn?.blok?.ua;
        this.blockUserIdentities = dataPlan?.document?.dtpn?.blok?.ui;

        const dataPoints = dataPlan?.document?.dtpn?.vers?.version_document?.data_points
        if (dataPlan) {
            if (dataPoints && dataPoints.length > 0) {
                dataPoints.forEach(point => this.addToMatchLookups(point));
            } else {
                this.mpInstance.Logger.error('There was an issue with the data plan');
                return;
            }
        }
    }

    addToMatchLookups(point: DataPlanPoint) {
        if (!point.match || !point.validator) {
            this.mpInstance.Logger.warning(`Data Plan Point is not valid' + ${point}`);
            return;
        }

        // match keys for non product custom attribute related data poins
        let matchKey: string = this.generateMatchKey(point.match);
        let properties: null | Boolean | {[key: string]: true}  = this.getEventProperties(point.match.type, point.validator)
        
        this.dataPlanMatchLookups[matchKey] = properties;

        // match keys for product custom attribute related data poins
        if (point.match.type === DataPlanMatchType.ProductImpression ||
            point.match.type === DataPlanMatchType.ProductAction ||
            point.match.type === DataPlanMatchType.PromotionAction) {

            matchKey = this.generateProductAttributeMatchKey(point.match);
            properties = this.getProductProperties(point.match.type, point.validator)
        
            this.dataPlanMatchLookups[matchKey] = properties;
        }
    }

    generateMatchKey(match): string | null {
        switch (match.type) {
            case DataPlanMatchType.CustomEvent:
                const customEventCriteria = match.criteria;

                return [
                    DataPlanMatchType.CustomEvent,
                    customEventCriteria.custom_event_type,
                    customEventCriteria.event_name,
                ].join(':');

            case DataPlanMatchType.ScreenView:
                const screenViewCriteria = match.criteria;
                return [
                    DataPlanMatchType.ScreenView,
                    '',
                    screenViewCriteria.screen_name,
                ].join(':');

            case DataPlanMatchType.ProductAction:
                const productActionMatch = match.criteria;
                return [match.type as string, productActionMatch.action].join(':');

            case DataPlanMatchType.PromotionAction:
                const promoActionMatch = match.criteria;
                return [match.type as string, promoActionMatch.action].join(':');

            case DataPlanMatchType.ProductImpression:
                const productImpressionActionMatch = match.criteria;
                return [match.type as string, productImpressionActionMatch.action].join(':');

            case DataPlanMatchType.UserIdentities:
            case DataPlanMatchType.UserAttributes:
                return [match.type].join(':');

            default:
                return null;
        }
    }

    generateProductAttributeMatchKey(match): string | null {
        switch (match.type) {
            case DataPlanMatchType.ProductAction:
                const productActionMatch = match.criteria;
                return [match.type as string, productActionMatch.action, 'ProductAttributes'].join(':');

            case DataPlanMatchType.PromotionAction:
                const promoActionMatch = match.criteria;
                return [match.type as string, promoActionMatch.action, 'ProductAttributes'].join(':');

            case DataPlanMatchType.ProductImpression:
                const productImpressionActionMatch = match.criteria;
                return [match.type as string, productImpressionActionMatch.action, 'ProductAttributes'].join(':');

            default:
                return null;
        }
    }

    getEventProperties(type, validator): Boolean | {[key: string]: true} | null {
        let customAttributes;
        let userAdditionalProperties;
        switch (type) {
            case DataPlanMatchType.CustomEvent:
            case DataPlanMatchType.ScreenView:
            case DataPlanMatchType.ProductAction:
            case DataPlanMatchType.PromotionAction:
            case DataPlanMatchType.ProductImpression:
                customAttributes = validator?.definition?.properties?.data?.properties?.custom_attributes
                if (customAttributes) {
                    if (customAttributes.additionalProperties) {
                        return true;
                    } else {
                        let properties = {};
                        for (let property in customAttributes.properties) {
                            properties[property] = true;
                        }
                        return properties;
                    }
                } else {
                    return true;
                }
            case DataPlanMatchType.UserAttributes:
            case DataPlanMatchType.UserIdentities:
                userAdditionalProperties = validator?.definition?.additionalProperties;
                if (userAdditionalProperties) {
                    return true;
                } else {
                    let properties = {};
                    let userProperties = validator.definition.properties
                    for (let property in userProperties) {
                        properties[property] = true;
                    }
                    return properties;
                }
            default:
                return null;
        }
    }

    getProductProperties(type, validator): Boolean | {[key: string]: true} | null {
        let productCustomAttributes;
        switch (type) {
            case DataPlanMatchType.ProductAction:
            case DataPlanMatchType.PromotionAction:
            case DataPlanMatchType.ProductImpression:
                //product transaction attributes
                productCustomAttributes = validator?.definition?.properties?.data?.properties?.product_action?.properties?.products?.items?.properties?.custom_attributes
                //product item attributes
                if (productCustomAttributes) {
                    if (productCustomAttributes.additionalProperties) {
                        return true;
                    } else {
                        let properties = {};
                        for (let property in productCustomAttributes?.properties) {
                            properties[property] = true;
                        }
                        return properties;
                    }
                } else {
                    return true;
                }


            default:
                return null;
        }
    }

    getMatchKey(eventToMatch: BaseEvent): string | null {
        switch (eventToMatch.event_type) {
            case EventTypeEnum.screenView:
                const screenViewEvent = eventToMatch as any;
                if (screenViewEvent.data) {
                    return [
                        DataPlanMatchType.ScreenView,
                        'screen_view',
                        '',
                        screenViewEvent.data.screen_name,
                    ].join(':');
                }
                return null;
            case EventTypeEnum.commerceEvent:
                const commerceEvent = eventToMatch as any;
                const matchKey: string[] = [];

                if (commerceEvent && commerceEvent.data) {
                    const {
                        product_action,
                        product_impressions,
                        promotion_action,
                    } = commerceEvent.data;

                    if (product_action) {
                        matchKey.push(DataPlanMatchType.ProductAction);
                        matchKey.push(product_action.action);
                    } else if (promotion_action) {
                        matchKey.push(DataPlanMatchType.PromotionAction);
                        matchKey.push(promotion_action.action);
                    } else if (product_impressions) {
                        matchKey.push(DataPlanMatchType.ProductImpression);
                    }
                }
                return matchKey.join(':');
            case EventTypeEnum.customEvent:
                const customEvent: any = eventToMatch as any;
                if (customEvent.data) {
                    return [
                        'custom_event',
                        customEvent.data.custom_event_type,
                        customEvent.data.event_name,
                    ].join(':');
                }
                return null;
            default:
                return null;
        }
    }

    getProductAttributeMatchKey(eventToMatch: BaseEvent): string | null {
        switch (eventToMatch.event_type) {
            case EventTypeEnum.commerceEvent:
                const commerceEvent = eventToMatch as any;
                const matchKey: string[] = [];
                const {
                    product_action,
                    product_impressions,
                    promotion_action,
                } = commerceEvent.data;

                if (product_action) {
                    matchKey.push(DataPlanMatchType.ProductAction);
                    matchKey.push(product_action.action);
                    matchKey.push('ProductAttributes');
                } else if (promotion_action) {
                    matchKey.push(DataPlanMatchType.PromotionAction);
                    matchKey.push(promotion_action.action);
                    matchKey.push('ProductAttributes');
                } else if (product_impressions) {
                    matchKey.push(DataPlanMatchType.ProductImpression);
                    matchKey.push('ProductAttributes');
                }
                return matchKey.join(':');
            default:
                return null;
        }
    }

    createBlockedEvent(event: SDKEvent): SDKEvent {
        // mutate the event/event attributes, then the user attributes, then the user identities
        if (event) {
            event = this.mutateEventAndEventAttributes(event)
        }
    
        if (event && event.EventDataType === Types.MessageType.Commerce) {
            event = this.mutateProductAttributes(event);
        }

        if (event) {
            event = this.mutateUserAttributes(event);
            event = this.mutateUserIdentities(event);
        }

        return event
    }

    mutateEventAndEventAttributes(event: SDKEvent): SDKEvent {
        let baseEvent: BaseEvent = convertEvent(event);
        let matchKey: string = this.getMatchKey(baseEvent);
        let matchedEvent = this.dataPlanMatchLookups[matchKey];

        if (this.blockEvents) {
            /* 
                If the event is not planned, it doesn't exist in dataPlanMatchLookups
                and should be blocked (return null to not send anything to forwarders)
            */
            if (!matchedEvent) {
                return null;
            }
        }

        if (this.blockEventAttributes) {
            /* 
                matchedEvent is set to `true` if additionalProperties is `true`
                otherwise, delete attributes that exist on event.EventAttributes
                that aren't on 
            */
            if (matchedEvent === true) {
                return event;
            }
            if (matchedEvent) {
                for (let key in event.EventAttributes) {
                    if (!matchedEvent[key]) {
                        delete event.EventAttributes[key];
                    }
                }
                return event;
            } else {
                return event;
            }
        }

        return event;
    }

    mutateProductAttributes(event: SDKEvent): SDKEvent {
        let baseEvent: BaseEvent = convertEvent(event);
        let matchKey: string = this.getProductAttributeMatchKey(baseEvent);
        let matchedEvent = this.dataPlanMatchLookups[matchKey];

        if (this.blockEvents) {
            /* 
                If the event is not planned, it doesn't exist in dataPlanMatchLookups
                and should be blocked (return null to not send anything to forwarders)
            */
            if (!matchedEvent) {
                return null;
            }
        }

        if (this.blockEventAttributes) {
            /* 
                matchedEvent is set to `true` if additionalProperties is `true`
                otherwise, delete attributes that exist on event.EventAttributes
                that aren't on 
            */
            if (matchedEvent === true) {
                return event;
            }
            if (matchedEvent) {
                event.ProductAction?.ProductList?.forEach(product => {
                    for (let productKey in product.Attributes) {
                    if (!matchedEvent[productKey]) {
                        delete product.Attributes[productKey];
                    }
                }
            })
                
                return event;
            } else {
                return event;
            }
        }

        return event;
    }

    mutateUserAttributes(event: SDKEvent) {
        if (this.blockUserAttributes) {
            /* 
                If the user attribute is not found in the matchedAttributes
                then remove it from event.UserAttributes as it is blocked
            */
            let matchedAttributes = this.dataPlanMatchLookups['user_attributes'];
                if (this.mpInstance._Helpers.isObject(matchedAttributes)) {
                    for (let ua in event.UserAttributes) {
                        if (!matchedAttributes[ua]) {
                            delete event.UserAttributes[ua]
                        }
                    }
                }
        }
    
        return event
    }

    isAttributeKeyBlocked(key: string) {
        /* used when an attribute is added to the user */
        if (!this.kitBlockingEnabled) {
            return false
        }
        if (this.blockUserAttributes) {
            let matchedAttributes = this.dataPlanMatchLookups['user_attributes'];
            if (matchedAttributes === true) {
                return false
            }
            if (!matchedAttributes[key]) {
                return true
            }
        } else {
            return false
        }
        return false
    }

    mutateUserIdentities(event: SDKEvent) {
            /* 
                If the user identity is not found in matchedIdentities
                then remove it from event.UserIdentities as it is blocked.
                event.UserIdentities is of type [{Identity: 'id1', Type: 7}, ...]
                and so to compare properly in matchedIdentities, each Type needs 
                to be converted to an identityName
            */
        if (this.blockUserIdentities) {
            let matchedIdentities = this.dataPlanMatchLookups['user_identities'];
            if (this.mpInstance._Helpers.isObject(matchedIdentities)) {
                if (event?.UserIdentities?.length) {
                    event.UserIdentities.forEach((uiByType, i) => {
                        const identityName = Types.IdentityType.getIdentityName(
                            this.mpInstance._Helpers.parseNumber(uiByType.Type)
                        );
    
                        if (!matchedIdentities[identityName]) {
                            event.UserIdentities.splice(i, 1);
                        }
                    });
                }
            }
        }
        return event
    }
}