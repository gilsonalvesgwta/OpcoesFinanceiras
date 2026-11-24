-- WTA Options Intelligence — 0018: extrato de negociação da B3 e cadastro histórico de séries.
--
-- execucoes.origem ganha 'extrato_b3' (negócios vindos do extrato da Área do Investidor;
-- sem custos até a nota de corretagem do mesmo negócio ser importada, que os completa).
-- importacoes.fonte ganha 'b3-series-anual' (arquivo anual da B3, só o cadastro das séries).

alter table execucoes drop constraint execucoes_origem_check;
alter table execucoes add constraint execucoes_origem_check check (origem in ('manual', 'importada_mt5', 'nota_corretagem', 'posicao_inicial', 'extrato_b3'));

alter table importacoes drop constraint importacoes_fonte_check;
alter table importacoes add constraint importacoes_fonte_check check (fonte in ('b3-cotahist', 'b3-cotahist-mensal', 'bcb-selic', 'brapi', 'b3-series-anual'));
