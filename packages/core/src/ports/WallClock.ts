/**
 * Porta do relógio de parede em milissegundos, usada só pela sincronização. Fica separada
 * da `Clock` porque o HLC precisa de milissegundos (sincronizacao §3.2) e a `Clock` entrega o
 * instante no formato do schema, com precisão de segundo; trocar a `Clock` obrigaria todo
 * adaptador e todo teste a fornecer uma leitura que só a sincronização consome.
 */
export interface WallClock {
    /**
     * @return Milissegundos desde a época Unix, pelo relógio do sistema; pode parar ou
     * voltar (NTP, ajuste manual), e o HLC tolera isso.
     */
    millis(): number;
}
