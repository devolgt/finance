import { render, screen } from '@testing-library/react-native';
import type { ContractReport } from '../src/contractReport.ts';
import { ContractScreen } from '../src/ContractScreen.tsx';
import type { CryptoBenchmarkReport } from '../src/cryptoBenchmark.ts';

/**
 * Resultado de teste com os contadores preenchidos.
 *
 * @param failures Falhas do resultado; vazia para o caso que passou.
 * @return O resultado.
 */
function report(failures: ContractReport['failures']): ContractReport {
    return { passed: failures.length === 0, sqliteVersion: '3.53.3', databaseCases: 13, goldenCases: 900, failures };
}

describe('tela do contrato', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('mostra o texto que o Maestro espera quando passa, e registra no log', async () => {
        await render(<ContractScreen run={() => report([])} />);

        expect(await screen.findByText('Contrato: passou')).toBeOnTheScreen();
        expect(screen.getByText('SQLite 3.53.3 · 13 casos do banco · 900 vetores de ouro')).toBeOnTheScreen();
        expect(console.log).toHaveBeenCalledWith('[contrato] PASSOU sqlite=3.53.3 banco=13 vetores=900 falhas=0');
    });

    it('depois do contrato, mede a cifra da sincronização e mostra a vazão e o handshake', async () => {
        /** @return Uma medição fixa, para conferir o texto da tela e do log. */
        const benchmark = (): CryptoBenchmarkReport => ({ cipherMbPerSecond: 3.25, cipherBytes: 8_388_608, handshakeMs: 41.5, handshakes: 20 });
        await render(<ContractScreen run={() => report([])} benchmark={benchmark} />);

        expect(await screen.findByText('Cifra ChaCha20-Poly1305: 3.3 MB/s · handshake Noise KK: 41.5 ms')).toBeOnTheScreen();
        expect(screen.getByText('Contrato: passou')).toBeOnTheScreen();
        expect(console.log).toHaveBeenCalledWith('[cifra] chacha20poly1305=3.25MB/s bytes=8388608 handshake-kk=41.50ms n=20');
    });

    it('mostra cada falha quando diverge', async () => {
        await render(<ContractScreen run={() => report([{ source: 'vetores:client', description: 'format.money {"amount":1}: Node "R$ 1,00", aqui "R$ 1,00"' }])} />);

        expect(await screen.findByText('Contrato: falhou')).toBeOnTheScreen();
        expect(screen.getByText('vetores:client — format.money {"amount":1}: Node "R$ 1,00", aqui "R$ 1,00"')).toBeOnTheScreen();
    });
});
