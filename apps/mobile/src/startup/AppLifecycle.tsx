import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Quem reage ao app entrar e sair do primeiro plano. */
export interface LifecycleListener {
    readonly onForeground: () => void;
    readonly onBackground: () => void;
}

/**
 * O único ponto do app que escuta o `AppState` (mobile §10). A tela de Dispositivos
 * se inscreve (`useAppForeground`) para encerrar a sessão, fechar o listener e parar o anúncio
 * quando o app sai do primeiro plano; um ponto só evita que cada tela assine o `AppState` por
 * conta própria e uma esqueça de desligar. A sincronização só acontece com a tela de
 * sincronização aberta, nunca em segundo plano.
 */
export class AppLifecycle {
    private readonly listeners = new Set<LifecycleListener>();
    private foreground = true;

    /**
     * @param listener Quem quer saber das trocas de estado.
     * @return Função que cancela a inscrição.
     */
    public subscribe(listener: LifecycleListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * @return `true` enquanto o app está visível; quem se inscreve depois de uma troca precisa
     * saber o estado atual, e não só as próximas trocas.
     */
    public isForeground(): boolean {
        return this.foreground;
    }

    /**
     * Repassa a troca de estado do sistema. `inactive` (a gaveta de notificações aberta, a troca
     * de apps em andamento) não conta como saída: o app ainda está visível.
     *
     * @param state Estado informado pelo `AppState`.
     */
    public update(state: AppStateStatus): void {
        const foreground = state === 'active' || state === 'inactive';
        if (foreground === this.foreground) {
            return;
        }
        this.foreground = foreground;
        for (const listener of this.listeners) {
            if (foreground) {
                listener.onForeground();
            } else {
                listener.onBackground();
            }
        }
    }
}

const LifecycleContext = createContext<AppLifecycle | null>(null);

/**
 * Liga o `AppState` ao `AppLifecycle` na raiz do app, uma vez.
 *
 * @param props.children O app.
 * @param props.lifecycle Ciclo de vida a usar; os testes passam o deles para simular a saída do
 * primeiro plano, que o `AppState` do Jest não emite.
 * @return A árvore com o ciclo de vida disponível.
 */
export function AppLifecycleRoot(props: { readonly children: ReactNode; readonly lifecycle?: AppLifecycle }): ReactNode {
    const { children } = props;
    const [lifecycle] = useState(() => props.lifecycle ?? new AppLifecycle());
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            lifecycle.update(state);
        });
        return () => {
            subscription.remove();
        };
    }, [lifecycle]);
    return <LifecycleContext value={lifecycle}>{children}</LifecycleContext>;
}

/**
 * Diz se o app está em primeiro plano, e re-renderiza quando isso muda. A sincronização usa como
 * interruptor (mobile §10): sair do primeiro plano encerra a sessão sem esperar o
 * sistema cortar os sockets — um lote pela metade seria descartado de qualquer jeito, e o listener
 * aberto em segundo plano aceitaria conexões que o app não consegue atender.
 *
 * @return `true` enquanto o app está visível.
 * @throws {Error} Fora do `AppLifecycleRoot`.
 */
export function useAppForeground(): boolean {
    const lifecycle = useAppLifecycle();
    const [foreground, setForeground] = useState(() => lifecycle.isForeground());
    useEffect(() => {
        setForeground(lifecycle.isForeground());
        return lifecycle.subscribe({
            onForeground: () => {
                setForeground(true);
            },
            onBackground: () => {
                setForeground(false);
            },
        });
    }, [lifecycle]);
    return foreground;
}

/**
 * @return O ciclo de vida da raiz.
 * @throws {Error} Fora do `AppLifecycleRoot`.
 */
export function useAppLifecycle(): AppLifecycle {
    const lifecycle = useContext(LifecycleContext);
    if (lifecycle === null) {
        throw new Error('useAppLifecycle precisa do AppLifecycleRoot acima na árvore');
    }
    return lifecycle;
}
