-- Dados de exemplo para o teste da cadeia no navegador (só no banco do CI).
insert into fechamentos (dia, codigo, tipo_mercado, especificacao, maxima, minima, ultimo, melhor_compra, melhor_venda, negocios, quantidade, volume) values
  ('2026-10-16', 'ITUB4', 10, 'PN', 3620, 3560, 3590, 3589, 3591, 20000, 9000000, 32310000000),
  ('2026-10-16', 'ITUBK340', 70, 'PN', 215, 190, 205, 204, 207, 300, 120000, 24600000),
  ('2026-10-16', 'ITUBK360', 70, 'PN', 75, 60, 68, 67, 69, 900, 500000, 34000000),
  ('2026-10-16', 'ITUBK380', 70, 'PN', 20, 15, 17, 16, 18, 150, 80000, 1360000),
  ('2026-10-16', 'ITUBW340', 80, 'PN', 30, 25, 27, 26, 28, 120, 60000, 1620000),
  ('2026-10-16', 'ITUBW360', 80, 'PN', null, null, null, null, null, 0, 0, 0);
insert into series_opcoes (codigo, vencimento, ativo_objeto, tipo, strike, visto_primeiro, visto_ultimo) values
  ('ITUBK340', '2026-11-23', 'ITUB4', 'call', 3400, '2026-10-16', '2026-10-16'),
  ('ITUBK360', '2026-11-23', 'ITUB4', 'call', 3600, '2026-10-16', '2026-10-16'),
  ('ITUBK380', '2026-11-23', 'ITUB4', 'call', 3800, '2026-10-16', '2026-10-16'),
  ('ITUBW340', '2026-11-23', 'ITUB4', 'put', 3400, '2026-10-16', '2026-10-16'),
  ('ITUBW360', '2026-11-23', 'ITUB4', 'put', 3600, '2026-10-16', '2026-10-16');
insert into calculos_opcoes (dia, codigo, vencimento, ativo_objeto, spot, premio, origem_premio, dias_uteis, selic, vol_implicita, preco_teorico, delta, gamma, theta, vega, rho, motivo) values
  ('2026-10-16', 'ITUBK340', '2026-11-23', 'ITUB4', 3590, 205.5, 'meio_do_livro', 24, 14.9, 0.262, 2.055, 0.78, 0.09, -0.012, 0.031, 0.022, null),
  ('2026-10-16', 'ITUBK360', '2026-11-23', 'ITUB4', 3590, 68, 'meio_do_livro', 24, 14.9, 0.241, 0.68, 0.49, 0.15, -0.015, 0.044, 0.016, null),
  ('2026-10-16', 'ITUBK380', '2026-11-23', 'ITUB4', 3590, 17, 'meio_do_livro', 24, 14.9, 0.248, 0.17, 0.18, 0.09, -0.009, 0.028, 0.006, null),
  ('2026-10-16', 'ITUBW340', '2026-11-23', 'ITUB4', 3590, 27, 'meio_do_livro', 24, 14.9, 0.281, 0.27, -0.21, 0.09, -0.008, 0.029, -0.007, null);
insert into calculos_opcoes (dia, codigo, vencimento, motivo) values ('2026-10-16', 'ITUBW360', '2026-11-23', 'sem_premio');
-- Série de dezembro, para o teste das rolagens.
insert into fechamentos (dia, codigo, tipo_mercado, especificacao, maxima, minima, ultimo, melhor_compra, melhor_venda, negocios, quantidade, volume) values
  ('2026-10-16', 'ITUBL360', 70, 'PN', 145, 130, 139, 138, 141, 400, 200000, 27800000),
  ('2026-10-16', 'ITUBL380', 70, 'PN', 65, 52, 59, 58, 61, 250, 150000, 8850000);
insert into series_opcoes (codigo, vencimento, ativo_objeto, tipo, strike, visto_primeiro, visto_ultimo) values
  ('ITUBL360', '2026-12-18', 'ITUB4', 'call', 3600, '2026-10-16', '2026-10-16'),
  ('ITUBL380', '2026-12-18', 'ITUB4', 'call', 3800, '2026-10-16', '2026-10-16');
insert into calculos_opcoes (dia, codigo, vencimento, ativo_objeto, spot, premio, origem_premio, dias_uteis, selic, vol_implicita, preco_teorico, delta, gamma, theta, vega, rho, motivo) values
  ('2026-10-16', 'ITUBL380', '2026-12-18', 'ITUB4', 3590, 59.5, 'meio_do_livro', 43, 14.9, 0.252, 0.595, 0.29, 0.07, -0.007, 0.052, 0.013, null);
-- Selic e volatilidade da série de dezembro, para os cenários.
insert into taxas_juros (serie, dia, valor, fonte) values ('selic', '2026-10-16', 14.9, 'teste') on conflict do nothing;
insert into calculos_opcoes (dia, codigo, vencimento, ativo_objeto, spot, premio, origem_premio, dias_uteis, selic, vol_implicita, preco_teorico, delta, gamma, theta, vega, rho, motivo) values
  ('2026-10-16', 'ITUBL360', '2026-12-18', 'ITUB4', 3590, 139.5, 'meio_do_livro', 43, 14.9, 0.248, 1.395, 0.55, 0.08, -0.008, 0.06, 0.02, null);
