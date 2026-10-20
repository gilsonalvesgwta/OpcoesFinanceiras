-- WTA Options Intelligence — 0006: carga do histórico diário (arquivos mensais da B3)
-- e limpeza das opções antigas.
--
-- Os indicadores (médias de até 200 pregões, RSI, ATR, rompimentos) precisam de
-- histórico. O worker importa os arquivos mensais COTAHIST_MmmAAAA.ZIP dos últimos
-- 12 meses, guardando só o mercado à vista. Opções e cálculos com mais de 120 dias
-- são apagados (o histórico das ações fica).

alter table importacoes drop constraint importacoes_fonte_check;
alter table importacoes add constraint importacoes_fonte_check check (fonte in ('b3-cotahist', 'b3-cotahist-mensal', 'bcb-selic'));
grant delete on fechamentos to wtaopt_coleta;
