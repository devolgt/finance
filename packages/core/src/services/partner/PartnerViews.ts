import type { Partner } from '../../domain/partner/Partner.ts';

/**
 * Um sócio com quantos lançamentos estão vinculados a ele em todo o período — o que o cadastro precisa para
 * avisar, antes de salvar, quantos lançamentos ficam sem sócio ao removê-lo (socios §2.3).
 */
export interface PartnerWithUsage {
    readonly partner: Partner;
    readonly transactionCount: number;
}
