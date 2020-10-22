import { convertEvent } from './sdkToEventsApiConverter';
import { SDKEvent, MParticleWebSDK } from './sdkRuntimeModels';
import { BaseEvent, EventTypeEnum } from '@mparticle/event-models';
import Types from './types'
import { DataPlanPoint } from '@mparticle/data-planning-models';

// TODO: Why does this not build when importing from @mparticle/data-planning-models?!
var DataPlanMatchType = {
    Unknown: "unknown",
    SessionStart: "session_start",
    SessionEnd: "session_end",
    ScreenView: "screen_view",
    CustomEvent: "custom_event",
    CrashReport: "crash_report",
    OptOut: "opt_out",
    FirstRun: "first_run",
    ApplicationStateTransition: "application_state_transition",
    NetworkPerformance: "network_performance",
    Breadcrumb: "breadcrumb",
    Profile: "profile",
    Commerce: "commerce",
    UserAttributeChange: "user_attribute_change",
    UserIdentityChange: "user_identity_chagne",
    Uninstall: "uninstall",
    Media: "media",
    UserAttributes: "user_attributes",
    UserIdentities: "user_identities",
    ProductAction: "product_action",
    PromotionAction: "promotion_action",
    ProductImpression: "product_impression"
}


// create a KitBlocker class and pass dataPlan to constructor
// 1. generate match types for all data points to confirm event names are planned/unplanned
// 2. ...how do we add attributes to this structure?

// inspiration from https://github.com/mParticle/data-planning-node/blob/master/src/data_planning/data_plan_event_validator.ts
// but modified to only include commerce events, custom events, screen views, and removes validation

export default class KitBlocker {
    dataPlanMatchLookups: { [key: string]: {} } = {};
    blockEvents: Boolean = false;
    blockEventAttributes: Boolean = false;
    blockUserAttributes: Boolean = false;
    blockUserIdentities: Boolean = false;
    mpInstance: MParticleWebSDK;

    constructor(dataPlan: any, mpInstance: MParticleWebSDK) {
        this.mpInstance = mpInstance;
        this.blockEvents = dataPlan?.document?.dtpn?.blok?.ev;
        this.blockEventAttributes = dataPlan?.document?.dtpn?.blok?.ea;
        this.blockUserAttributes = dataPlan?.document?.dtpn?.blok?.ua;
        this.blockUserIdentities = dataPlan?.document?.dtpn?.blok?.ui;

        const dataPoints = dataPlan?.document?.dtpn?.vers?.version_document?.data_points

        if (dataPoints && dataPoints.length > 0) {
            dataPoints.forEach(point => this.addToMatchLookups(point));
        } else {
            this.mpInstance.Logger.error('There was an issue with the data plan');
            return;
        }
    }

    addToMatchLookups(point: DataPlanPoint) {
        if (!point.match || !point.validator) {
            this.mpInstance.Logger.warning(`Data Plan Point is not valid' + ${point}`);
            return;
        }

        const matchKey: string = this.generateMatchKey(point.match);
        const properties: null | Boolean | {[key: string]: true}  = this.getProperties(point.match.type, point.validator)

        this.dataPlanMatchLookups[matchKey] = properties;
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

    getProperties(type, validator): Boolean | {[key: string]: true} | null {
        switch (type) {
            case DataPlanMatchType.CustomEvent:
            case DataPlanMatchType.ScreenView:
            case DataPlanMatchType.ProductAction:
            case DataPlanMatchType.PromotionAction:
            case DataPlanMatchType.ProductImpression:
                let customAttributes = validator?.definition?.properties?.data?.properties?.custom_attributes
                if (customAttributes) {
                    if (customAttributes.additionalProperties) {
                        return true;
                    } else {
                        var properties = {};
                        for (var property in customAttributes.properties) {
                            properties[property] = true;
                        }
                        return properties;
                    }
                } else {
                    return true;
                }
            case DataPlanMatchType.UserAttributes:
            case DataPlanMatchType.UserIdentities:
                let userAdditionalProperties = validator?.definition?.additionalProperties;
                if (userAdditionalProperties) {
                    return true;
                } else {
                    var properties = {};
                    var userProperties = validator.definition.properties
                    for (var property in userProperties) {
                        properties[property] = true;
                    }
                    return properties;
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
                        matchKey.push('product_action');
                        matchKey.push(product_action.action);
                    } else if (promotion_action) {
                        matchKey.push(DataPlanMatchType.PromotionAction);
                        matchKey.push('promotion_action');
                        matchKey.push(promotion_action.action);
                    } else if (product_impressions) {
                        matchKey.push(DataPlanMatchType.ProductImpression);
                        matchKey.push('promotion_action');
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

    createBlockedEvent(event: SDKEvent): SDKEvent {
        // mutate the event/event attributes, then the user attributes, then the user identities
        if (event) {
            event = this.mutateEventAndEventAttributes(event)
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
                for (var key in event.EventAttributes) {
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

    mutateUserAttributes(event: SDKEvent) {
        if (this.blockUserAttributes) {
            /* 
                If the user attribute is not found in the matchedAttributes
                then remove it from event.UserAttributes as it is blocked
            */
            let matchedAttributes = this.dataPlanMatchLookups['user_attributes'];
            for (var ua in event.UserAttributes) {
                if (!matchedAttributes[ua]) {
                    delete event.UserAttributes[ua]
                }
            }
            return event
        } else {
            return event
        }
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