import type { HomeAssistant, LovelaceActionConfig } from "./ha-types";

export async function runAction(hass: HomeAssistant | undefined, action: LovelaceActionConfig | undefined): Promise<void> {
  if (!hass || !action || action.action === "none") {
    return;
  }

  if (action.action === "toggle" && action.entity) {
    await hass.callService("homeassistant", "toggle", undefined, { entity_id: action.entity });
    return;
  }

  if (action.action === "call-service" && action.service) {
    const [domain, service] = action.service.split(".");
    if (domain && service) {
      await hass.callService(domain, service, action.service_data, action.target);
    }
  }
}

