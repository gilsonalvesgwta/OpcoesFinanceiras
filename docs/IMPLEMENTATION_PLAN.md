# Plano de implementação

Cada etapa vai num ramo `claude/...` com pedido de mesclagem; com os testes do CI passando, é mesclada. Após cada etapa: o que foi feito, arquivos, testes, limitações, documentação atualizada e próximo passo.

| Fase | Entrega | Critério de aceitação | Situação |
| --- | --- | --- | --- |
| 1a | Documentação e motor de opções (`packages/domain`) | 9 documentos; payoff, posições, rolagens, modelo, qualidade, núcleo de alertas, calendário e contrato de provedores com testes de referência | **Feita** |
| 1b | Banco e acesso | Migrações (usuários, organizações, sessões, auditoria), RLS, `api` com login, sessão, convite, papéis, recuperação de senha, limites; testes de isolamento | Próxima |
| 2 | Interface | Layout escuro/claro, navegação lateral, painel, gestão de usuários, ativos favoritos, preferências | |
| 3 | Dados de mercado (gratuitos) | Download diário do COTAHIST da B3 (leitor já pronto), brapi gratuita para ações durante o pregão, Selic do Banco Central, gregas calculadas, qualidade e idade no painel, diagnóstico do provedor, calendário configurável | Leitor do COTAHIST feito |
| 4 | Alertas | Editor visual, persistência de estado, outbox, Telegram (vínculo, comandos, silêncio), indicadores (médias, RSI, VWAP, ATR, volume, rompimentos) | |
| 5 | Opções | Cadeia com filtros, vencimentos, strikes, gregas do provedor e calculadas com premissas, liquidez, gráficos | |
| 6 | Posições | Cadastro de execuções e estratégias, resultado, exposição, payoff com gráfico | |
| 7 | Rolagens | Simulador, comparador, confirmação, sugestões por critérios | |
| 8 | Inteligência operacional | Alertas de vencimento e de risco, sugestões proativas com consentimento, relatórios, desempenho das regras, cenários | |
| 9 | Produção | Segurança, carga compatível com a VPS, cópias e restauração, stack do Portainer, HTTPS, monitoramento, modo sombra, validação final | |

## Pendências do responsável

1. **Liberar a gravação do Claude no repositório** (GitHub App do Claude com acesso a `PortuguescomJoaopaulo`). Sem isso não há CI nem envio do código.
2. Criar a chave gratuita da brapi (brapi.dev, sem cartão) quando chegarmos à Fase 3.
3. Criar o bot no Telegram (@BotFather) e guardar o token para a stack.
4. Domínio da plataforma (ex.: `opcoes.wtatech.com.br`) e qual VPS recebe a stack.
5. Fontes pagas só se o responsável decidir depois (decisão de 16/10/2026: começar só com gratuitas).
