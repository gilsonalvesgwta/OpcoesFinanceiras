# Rolagens

Código em `packages/domain/src/rolagem.ts`.

## O que é uma rolagem aqui

Uma operação composta, gravada como um `roll_event` com execuções ligadas a ele:

1. encerramento total ou parcial de pernas abertas;
2. abertura de pernas novas (outro vencimento, outro strike, outra quantidade, ou só uma delas);
3. crédito ou débito líquido, com custos;
4. posição, exposição e risco recalculados.

A operação original **nunca é apagada nem editada**. A carteira depois da rolagem é a carteira antes mais as execuções novas.

## O que o simulador devolve (`simularRolagem`)

| Campo | Significado |
| --- | --- |
| `execucoes` | O que será gravado ao confirmar |
| `fluxo.encerramento` | + crédito / − débito de encerrar |
| `fluxo.abertura` | + crédito / − débito de abrir |
| `fluxo.custos` | Custos informados |
| `fluxo.liquido` e `natureza` | Resultado de caixa da rolagem: crédito, débito ou zero |
| `realizadoNoEncerramento` | Ganho ou perda realizado nas pernas encerradas, pelo preço médio |
| `realizadoAcumulado` | Realizado da estratégia antes e depois |
| `payoff.antes` / `payoff.depois` | Payoff da **estratégia** no vencimento: pernas abertas + realizado − custos pagos. Traz equilíbrio, lucro e perda máximos |
| `ultimoVencimento` | Antes e depois |
| `avisos` | Ver abaixo |

## Crédito não é lucro

Receber crédito ao rolar não quer dizer ganhar dinheiro. O simulador separa:

- crédito bruto, débito bruto e custos da rolagem;
- fluxo líquido da operação nova;
- resultado realizado antes e no encerramento;
- resultado projetado da estratégia depois da rolagem (payoff com o realizado incluído).

E acende avisos, com texto pronto em `TEXTO_DOS_AVISOS`:

| Aviso | Quando |
| --- | --- |
| `credito_nao_e_lucro` | Sempre que a rolagem gera crédito |
| `perda_maxima_aumentou` | A perda máxima teórica da estratégia ficou maior |
| `risco_passou_a_ilimitado` | Passou a ter perda teórica ilimitada |
| `prazo_prolongado` | O último vencimento ficou mais distante |
| `quantidade_aumentou` | Aumentou a quantidade de opções vendidas |
| `usa_preco_estimado` | Algum preço é último negócio ou ponto médio |
| `payoff_indisponivel` | A posição resultante mistura vencimentos; o payoff no vencimento não se aplica |

Exemplo coberto pelos testes: venda coberta com call vendida a 0,80; o preço sobe, a call é recomprada a 1,40 e outra call, um strike acima e um mês à frente, é vendida a 1,00. Débito de R$ 40, realizado de −R$ 60, equilíbrio da estratégia sobe de 29,20 para 29,60, prazo prolongado e perda máxima maior.

## Comparador (`compararRolagens`)

Recebe alternativas com nome e devolve todas, **na ordem em que vieram**, cada uma com os mesmos campos ou com o motivo da recusa. O sistema não elege "a melhor" e não ordena por crédito.

## Sugestões de rolagem (Fase 7)

Critérios configuráveis pelo usuário: dias até o vencimento, strike pretendido, delta desejado, crédito mínimo, débito máximo, liquidez mínima (volume, contratos em aberto), spread máximo, limite de risco, quantidade, prazo adicional, manter ou mudar o strike, reduzir exposição, manter a estrutura.

Para cada candidato, a sugestão lista os critérios **atendidos**, **não atendidos** e **sem dado** (ex.: delta ausente porque o plano não traz gregas). Nenhuma sugestão vira ordem, e nenhuma é enviada pelo Telegram sem o consentimento explícito do usuário.

Com as fontes gratuitas, os candidatos usam preços do fechamento do último pregão (arquivo oficial da B3), e a sugestão diz isso.

## Na api e na tela (Fase 7)

- `POST /api/rolagens/simular`: até 4 alternativas `{nome, encerrar[], abrir[]}`. Preço não informado = executável do momento (sair de vendida paga o ask, sair de comprada recebe o bid; abrir venda recebe o bid, abrir compra paga o ask); sem oferta, último negócio marcado como estimativa; sem nada, a alternativa volta com `sem_preco` (nunca zero). Série nova sem tipo/strike/vencimento é completada pelo cadastro da B3. Devolve, por alternativa, os preços usados com a origem, o fluxo, o realizado, o payoff da estratégia antes e depois, avisos com texto e as curvas de antes e depois na mesma faixa.
- `GET /api/rolagens/sugestoes`: séries do mesmo tipo nos próximos vencimentos (e, se pedido, no mesmo), strikes até ±30% do ativo, a partir do fechamento oficial da B3. Cada candidato simula sair da perna inteira e entrar na série nova, mesma quantidade e lado, sem custos. Critérios: `diasMin/diasMax`, `deltaMin/deltaMax` (delta calculado pelo sistema), `creditoMinimo`, `debitoMaximo`, `negociosMin`, `spreadMaximoPct`, `strike` (manter/acima/abaixo), `perdaMaximaNaoAumenta`. A lista sai por vencimento e strike, nunca por crédito.
- `POST /api/rolagens`: registra o que foi feito na corretora (preços obrigatórios). Grava a rolagem com o resumo e as execuções com `rolagem_id`; tudo auditado. Execução de rolagem não é apagada sozinha: `DELETE /api/rolagens/:id` desfaz a rolagem inteira.
- Contratos em aberto e volume financeiro mínimo não entram como critério: o COTAHIST não traz contratos em aberto.
