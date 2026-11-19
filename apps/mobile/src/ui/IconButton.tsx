import type { ReactNode } from 'react';
import { Pressable } from 'react-native';
import { Icon, type IconName } from './Icon.tsx';

/**
 * Botão redondo de ícone do cabeçalho: 44 px, o alvo de toque mínimo (desktop §7.7).
 *
 * @param props.icon Ícone.
 * @param props.label Nome acessível; o ícone é só visual.
 * @param props.onPress Ação.
 * @return O botão.
 */
export function IconButton({ icon, label, onPress }: { readonly icon: IconName; readonly label: string; readonly onPress: () => void }): ReactNode {
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} className="h-11 w-11 items-center justify-center rounded-full border border-line bg-bg active:bg-line2">
            <Icon name={icon} />
        </Pressable>
    );
}
