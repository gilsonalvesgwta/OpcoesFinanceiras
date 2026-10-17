# Motor de opções

Código em `packages/domain/src/`. Sem dependências; testes com `node --test` e casos de referência calculados à mão ou tirados de literatura (Hull).

## Convenções

- Dinheiro em **centavos inteiros** (`dinheiro.ts`). Soma que estoura o inteiro seguro é recusada, não arredondada.
- Valores que não caem em centavo exato (ponto de equilíbrio, preço médio) são números com fração e saem em reais com 4 casas quando exibidos.
- Quantidade sempre positiva; o lado (compra ou venda) dá o sinal.
- `multiplicador`: quantos ativos-objeto cada unidade representa. Nas opções sobre ações da B3 a quantidade já é em ações, então o padrão é 1. Nunca presumido para outros contratos: vem do cadastro.

## Modelo de posição

Um modelo genérico serve para todas as estruturas (compra ou venda de call e put, venda coberta, travas de alta e de baixa, de crédito e de débito, straddle, strangle, collar, condor, financiamento, estruturas livres). Cada perna é `call`, `put` ou `ativo`, comprada ou vendida, com quantidade, strike, vencimento, preço e custos.

A posição nunca é editada: ela é a consequência das **execuções** registradas (`posicoes.ts`). Método de custo: preço médio por instrumento.

## Payoff no vencimento (`payoff.ts`)

Resultado no vencimento a um preço S, já com custos de montagem:

    resultado(S) = Σ  sinal × quantidade × multiplicador × valor_intrínseco(S)  +  fluxo_de_montagem  +  ajuste

com valor intrínseco `max(S−K,0)` na call, `max(K−S,0)` na put e `S` no ativo. É linear por partes com quebras nos strikes. Por isso:

- **Pontos de equilíbrio**: raízes exatas de cada segmento, inclusive depois do último strike. Segmento plano sobre o zero vira faixa, não ponto.
- **Lucro e perda máximos**: ficam num strike, em zero ou no infinito. Se a inclinação depois do último strike é positiva, lucro ilimitado; se negativa, perda ilimitada (teórica, porque o preço não tem teto). Abaixo, o preço para em zero, então a perda de uma put vendida é limitada e grande, e é mostrada assim.
- `ajuste` soma caixa fora das pernas (resultado já realizado da estratégia), usado no "depois" das rolagens.

Limites declarados:
- Só vale **no vencimento** e para pernas do **mesmo vencimento**. Calendário e diagonal são recusados aqui (`vencimentos_diferentes`) e vão para os cenários com modelo de preço.
- **Não modela exercício antecipado.** Opção americana vendida pode ser exercida antes. A interface mostra esse aviso em toda posição com opção americana vendida dentro do dinheiro ou perto do vencimento ou de data com dividendo.
- Custo de exercício e liquidação não está no payoff.

## Resultado (`posicoes.ts`)

- **Realizado bruto**: diferença de preço das quantidades encerradas, pelo preço médio.
- **Custos pagos**: soma dos custos de todas as execuções, em campo separado.
- **Realizado líquido**: realizado bruto menos todos os custos pagos (critério conservador: inclui o custo de abrir o que ainda está aberto).
- **Não realizado estimado**: marcação das quantidades abertas pelo lado executável. Se falta preço de qualquer instrumento, o total fica `null` e a lista do que falta aparece. Nunca vira zero.
- Lucro não realizado nunca aparece como recebido; último negócio nunca é tratado como preço garantido de encerramento.

## Exposição

Por ativo-objeto e vencimento: quantidades líquidas de calls, puts e ações (em ativos-objeto), nocional pelos strikes e calls vendidas descobertas. O critério de cobertura é simples e declarado (ações e calls compradas do mesmo vencimento cobrem calls vendidas, sem olhar strike).

## Modelo de preço (`modelo.ts`)

Black-Scholes-Merton com preço, delta, gamma, vega (por 1 ponto de volatilidade), theta (por dia útil) e rho (por 1 ponto de juros), e volatilidade implícita por bissecção. Premissas, exibidas com cada número calculado (`PREMISSAS_DO_MODELO`):

1. Exercício europeu.
2. Volatilidade e juros constantes até o vencimento.
3. Tempo em dias úteis sobre 252; juros em taxa contínua (`taxaContinua` converte a taxa efetiva anual).
4. Dividendos só como rendimento contínuo.
5. Para opções americanas é aproximação e não descarta exercício antecipado.

Gregas do provedor e gregas calculadas são tipos diferentes; a tela diz qual é qual. Prêmio abaixo do valor intrínseco não gera volatilidade implícita (`abaixo_do_valor_intrinseco`).

Nenhuma tela mostra "probabilidade de sucesso" sem dizer modelo, dados e premissas.

## Qualidade das cotações (`cotacoes.ts`)

Ver `DATA_SOURCES.md`. Regras centrais: ausente é `null`; ponto médio é sempre estimativa; idade acima de 2 ciclos do provedor é "atrasado"; fora do pregão é "histórico".

## Calendário (`calendario.ts`)

Feriados e sessões especiais vêm de configuração (tabela editável pelo superadministrador); nada fixo no código. Vencimento mensal de opções sobre ações: terceira sexta-feira, adiado para o pregão seguinte quando não há pregão; o vencimento oficial de cada série vem do provedor.

## Testes de referência

| Arquivo | O que confere |
| --- | --- |
| `payoff.test.ts` | Compra de call, venda de put, venda coberta, trava de alta, straddle vendido, iron condor, custos, equilíbrio fracionário, multiplicador, recusas |
| `posicoes.test.ts` | Preço médio, realizado em encerramento parcial e virada de lado, marcação por bid/ask, `null` sem preço, exposição |
| `rolagem.test.ts` | Rolagem com débito e com crédito, parcial, vencimentos misturados, recusas, comparador |
| `modelo.test.ts` | Valores de Hull (preço, delta, gamma, vega, theta, rho), paridade put-call, volatilidade implícita |
| `alertas.test.ts` | Cruzamentos, histerese, qualidade, fora de ordem, reinício, condições compostas, limites, janela |
| `diversos.test.ts` | Qualidade, preço de encerramento, sanidade, código de opção, calendário, dinheiro |
| `cotahist.test.ts` | Leitura do arquivo oficial da B3: ações, opções, oferta zerada, fator de cotação, ligação opção → ativo-objeto |

## Gregas do fechamento (Fase 3b)

Calculadas pelo worker depois de cada arquivo da B3 (`calcularDoFechamento` em `packages/domain/src/calculo-diario.ts`) e guardadas em `calculos_opcoes`:

- prêmio: meio da melhor oferta de compra e de venda no fechamento, se as duas existem e o spread não passa de 50% do meio; senão o último negócio do dia; senão não calcula (`sem_premio`);
- ativo-objeto: último preço do mesmo pregão; juros: Selic do dia ou a mais recente antes dele (taxa contínua);
- tempo: dias de pregão do fechamento até o vencimento (calendário do banco) sobre 252; no dia do vencimento não calcula;
- dividendos: q = 0. Sem resultado, a linha guarda o motivo e os números ficam vazios (nunca zero).
- A api devolve a cadeia em `/api/mercado/cadeia?ativo=PETR4&vencimento=AAAA-MM-DD` com as premissas.
