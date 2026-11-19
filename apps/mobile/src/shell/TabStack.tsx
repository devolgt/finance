import { Stack } from 'expo-router';
import type { ReactNode } from 'react';

/**
 * Pilha de uma aba (mobile §5.1): cada aba guarda as próprias telas
 * abertas, e o "voltar" do Android desempilha a aba aberta antes de trocar de aba. Sem o
 * cabeçalho do roteador, porque cada tela desenha o próprio `ScreenHeader`.
 *
 * @return O navegador da pilha.
 */
export function TabStack(): ReactNode {
    return <Stack screenOptions={{ headerShown: false }} />;
}
