/**
 * Uma migration embutida no bundle. A versão é o próprio `PRAGMA user_version` que ela
 * produz (banco-de-dados §5.2), por isso é sequencial e sem lacunas.
 */
export interface Migration {
    readonly version: number;
    readonly name: string;
    readonly sql: string;
}
