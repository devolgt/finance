import type { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import type { Profile } from '../../domain/profile/Profile.ts';
import type { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { InvoiceCycle } from '../invoice/InvoiceCycle.ts';

/** Um cartão com a fatura do mês pedido e o limite usado. */
export interface CreditCardInPeriod {
    readonly creditCard: CreditCard;
    readonly invoiceOfMonth: InvoiceCycle;
    /**
     * Valor a pagar das faturas em aberto até a fatura aberta hoje e, depois dela, só o já
     * comprometido: as ocorrências futuras de séries fixas ficam fora (cartoes-e-faturas §4).
     */
    readonly limitUsed: Money;
}

/**
 * A lista de cartões de um mês, como a tela de Cartões mostra. Fica fora do arquivo do
 * `CreditCardService` para que a camada DTO dependa só do contrato de saída.
 */
export interface CreditCardListView {
    readonly profile: Profile;
    readonly period: YearMonth;
    readonly creditCards: readonly CreditCardInPeriod[];
    /** Valor a pagar das faturas do mês ainda em aberto. */
    readonly openTotal: Money;
    /** Valor a pagar de todas as faturas do mês, pagas ou não. */
    readonly total: Money;
}
