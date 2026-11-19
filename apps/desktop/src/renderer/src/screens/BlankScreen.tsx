import type { ReactNode } from 'react';
import { EmptyState } from '@/components/states';

/**
 * Tela em branco dentro do shell, com título, para um item do menu cuja tela ainda não existe:
 * a rota e a navegação ficam prontas antes da tela. Hoje todo item do menu tem tela própria
 * (desktop §8.1), e nenhuma rota a usa.
 *
 * @param props.title Título da tela, o mesmo do item do menu.
 * @param props.description Por que a tela está vazia.
 * @return O título e o aviso de tela vazia.
 */
export function BlankScreen({ title, description }: { readonly title: string; readonly description: string }): ReactNode {
    return (
        <>
            <h1 className="text-24 font-semibold">{title}</h1>
            <EmptyState title="Nada por aqui ainda" description={description} />
        </>
    );
}

/** Explicação das telas que ficam fora do MVP. */
const OUTSIDE_MVP = 'Esta tela chega numa próxima versão do app.';

/**
 * Cria a tela em branco de uma rota, no formato que o roteador pede (componente sem props).
 *
 * @param title Título da tela.
 * @return O componente da rota, que explica que a tela chega numa próxima versão.
 */
export function blankScreen(title: string): () => ReactNode {
    return function RouteBlankScreen(): ReactNode {
        return <BlankScreen title={title} description={OUTSIDE_MVP} />;
    };
}
