-- WTA Options Intelligence — 0019: índices do cadastro de séries.
--
-- Com o histórico do arquivo anual da B3 (anos de séries), consultas por "visto por último"
-- e por vencimento passaram a varrer a tabela inteira (a Minha carteira ficava sem carregar).
create index if not exists series_opcoes_visto on series_opcoes (visto_ultimo);
create index if not exists series_opcoes_vencimento on series_opcoes (vencimento);
analyze series_opcoes;
