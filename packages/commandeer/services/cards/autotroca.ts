import type { ButtonSpec } from '@girae/common/dbos/messaging'

export const AUTOTROCA_BULK_QUICKVIEW = 'autotroca-bulk'

export function autotrocaContent(enabled: boolean): string {
  return enabled
    ? 'A partir de agora, cards novos serão trocáveis por padrão! 🔄'
    : 'A partir de agora, cards novos não serão trocáveis por padrão.'
}

export function autotrocaBulkButton(enabled: boolean): ButtonSpec {
  return {
    text: enabled ? '🔄 Marcar cards que eu já tenho como trocáveis' : '🔒 Marcar cards que eu já tenho como não trocáveis',
    quickView: { handler: AUTOTROCA_BULK_QUICKVIEW, arg: enabled ? 'true' : 'false' },
    color: 'secondary',
  }
}
