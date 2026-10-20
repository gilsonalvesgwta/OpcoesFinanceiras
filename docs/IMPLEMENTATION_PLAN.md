# Plano de implementação

Cada etapa vai num ramo `claude/...` com pedido de mesclagem; com os testes do CI passando, é mesclada. Após cada etapa: o que foi feito, arquivos, testes, limitações, documentação atualizada e próximo passo.

| Fase | Entrega | Critério de aceitação | Situação |
| --- | --- | --- | --- |
| 1a | Documentação e motor de opções (`packages/domain`) | 9 documentos; payoff, posições, rolagens, modelo, qualidade, núcleo de alertas, calendário e contrato de provedores com testes de referência | **Feita** |
| 1b | Banco e acesso | Migrações (usuários, organizações, sessões, auditoria), RLS, `api` com login, sessão, convite, papéis, recuperação de senha, limites; testes de isolamento | **Feita** |
| 2 | Interface | Layout escuro/claro, navegação lateral, painel, gestão de usuários, ativos favoritos, preferências | **Feita** (prévia aprovada em 16/10/2026) |
| 2b | Ponte com o MetaTrader 5 (Genial) | Chave própria da ponte (criada e revogada pelo usuário), robô MQL5 só leitura, cotações e posições da conta gravadas só para o dono, qualidade pelo pulso da ponte, testes de banco, domínio e api | **Feita** (prévia aprovada em 16/10/2026); falta instalar o MT5 na VPS |
| 3 | Dados de mercado (gratuitos) | Download diário do COTAHIST da B3 (leitor já pronto), brapi gratuita para ações durante o pregão, Selic do Banco Central, gregas calculadas, qualidade e idade no painel, diagnóstico do provedor, calendário configurável | **3a feita**: coleta do COTAHIST diário e da Selic (worker), calendário no banco (feriados de 2026 da B3), fechamento da B3 no painel, rotas de calendário e diagnóstico. Telas de Diagnóstico, Calendário e quadro das fontes feitas (prévia aprovada em 17/10/2026). **3b feita**: volatilidade implícita e gregas do fechamento, rota da cadeia. Falta: brapi (depende da chave) |
| 4 | Alertas | Editor visual, persistência de estado, outbox, Telegram (vínculo, comandos, silêncio), indicadores (médias, RSI, VWAP, ATR, volume, rompimentos) | **4a feita**: regras, motor ligado à ponte MT5, eventos, avisos, vínculo e comandos do Telegram (bot depende do token). **4b feita**: tela de alertas (editor, histórico) e Telegram em Preferências. **4c feita**: indicadores (médias, RSI, ATR, volume relativo, rompimentos) com carga do histórico mensal; VWAP depende de fonte intradiária |
| 5 | Opções | Cadeia com filtros, vencimentos, strikes, gregas do provedor e calculadas com premissas, liquidez, gráficos | **Feita** (fechamento da B3): cadeia com calls e puts por strike, faixa, só negociadas, gregas com premissas e motivo quando não calcula, sorriso de volatilidade |
| 6 | Posições | Cadastro de execuções e estratégias, resultado, exposição, payoff com gráfico | **Feita**: estratégias com execuções (RLS do dono, auditoria), resultado realizado e estimado (bid/ask, senão último negócio), payoff no vencimento com gráfico e equilíbrio, exposição somada e calls sem cobertura, "venceu sem exercício", série preenchida pelo cadastro da B3, conferência e importação das posições do MT5 |
| 7 | Rolagens | Simulador, comparador, confirmação, sugestões por critérios | |
| 8 | Inteligência operacional | Alertas de vencimento e de risco, sugestões proativas com consentimento, relatórios, desempenho das regras, cenários | |
| 9 | Produção | Segurança, carga compatível com a VPS, cópias e restauração, stack do Portainer, HTTPS, monitoramento, modo sombra, validação final | |

## Pendências do responsável

1. Criar a chave gratuita da brapi (brapi.dev, sem cartão) quando chegarmos à Fase 3.
2. Criar o bot no Telegram (@BotFather) e guardar o token para a stack.
3. Domínio decidido: `opcoes.wtatech.com.br`. VPS: a mesma do CRM (17/10/2026); instalação portátil e cópias prontas (`docs/INSTALACAO.md`).
4. MetaTrader 5: conferir se a Genial fornece senha de investidor (só leitura) e, no primeiro pregão com a ponte, comparar a hora das cotações com o Book do MT5.
5. Fontes pagas só se o responsável decidir depois (decisão de 16/10/2026: começar só com gratuitas).
