import { useCoreQuery } from '@finance/client';
import { Link, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useActiveProfile } from './activeProfile.tsx';
import { isItemActive, menuFor } from './navigation.ts';
import { ProfileSwitcher } from './ProfileSwitcher.tsx';

/**
 * Barra lateral do shell (mockup `Main`): marca, seletor de perfil, menu e rodapé. Os relatórios
 * não são subitens do menu, como nos mockups: ficam na lista da página de Relatórios, a pedido do
 * usuário (`ReportsLayout`). O rodapé diz onde os dados estão (`SyncFooter`).
 * Regra de negócio (Perfis): o menu vem do perfil ativo (`menuFor`), e não de uma lista fixa,
 * porque Sócios só existe no perfil empresarial (desktop-mvp-plan, Fase 13.11).
 *
 * @return A navegação principal.
 */
export function Sidebar(): ReactNode {
    const { profile } = useActiveProfile();
    const pathname = useLocation({ select: (location) => location.pathname });
    return (
        <nav aria-label="Navegação principal" className="flex h-full w-58 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-surface px-3.5 py-5">
            <div className="px-2 text-17 font-semibold">Finanças</div>
            <ProfileSwitcher />
            <ul className="flex flex-col gap-0.5 text-14">
                {menuFor(profile.type).map((item) => {
                    const active = isItemActive(item, pathname);
                    return (
                        <li key={item.to}>
                            <Link
                                to={item.to}
                                aria-current={active ? 'page' : undefined}
                                className={cn('block rounded-6 px-3 py-2.25 text-ink hover:bg-surface2', active && 'bg-soft font-medium text-soft-ink hover:bg-soft')}
                            >
                                {item.label}
                            </Link>
                        </li>
                    );
                })}
            </ul>
            <SyncFooter />
        </nav>
    );
}

/**
 * Rodapé da barra lateral. Diz "Dados só neste aparelho" fora de um grupo ou depois de sair
 * dele; dentro, com quantos aparelhos os dados são compartilhados (sync-plan Fase 7). Não
 * promete "sincronizado agora": a sincronização só roda com a tela de Dispositivos aberta
 * (sync-design §7.1).
 *
 * @return O rodapé.
 */
function SyncFooter(): ReactNode {
    const status = useCoreQuery('sync.status', {});
    const members = status.data?.members ?? [];
    const peers = members.filter((member) => !member.isSelf && !member.removed).length;
    // Sair do grupo mantém o `groupId` (a identidade fica para a última sessão); o que conta é
    // este aparelho ainda ser membro ativo, como no menu Mais do celular.
    const inGroup = members.some((member) => member.isSelf && !member.removed) && peers > 0;
    return (
        <div className="mt-auto flex items-center gap-2 border-t border-line p-3 text-12 text-muted">
            {inGroup && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-dot" />}
            {inGroup ? `Dados neste aparelho e em ${peers === 1 ? 'mais 1' : `mais ${String(peers)}`} do grupo` : 'Dados só neste aparelho'}
        </div>
    );
}
