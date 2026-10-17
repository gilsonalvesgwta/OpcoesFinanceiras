# Ponte com o MetaTrader 5 (Genial)

O robô `WTA_Ponte.mq5` roda dentro do MetaTrader 5 logado na sua conta da corretora e envia ao sistema:

- **cotações** dos seus ativos favoritos e dos ativos em que você tem posição (a cada 1,5 s, só o que mudou);
- um **pulso** a cada 5 s, que prova que a ponte está viva (é isso que permite mostrar "tempo real");
- as **posições abertas** da conta (a cada 10 s).

É **só leitura**: o arquivo não usa nenhuma função de negociação e o sistema não tem rota que envie ordem.

## O que esses dados são (e não são)

- São os preços que a sua conta recebe da corretora. A Genial não informa publicamente se o MT5 do cliente pessoa física recebe o pregão em tempo real ou com atraso; o sistema mostra a hora de cada mudança para você conferir com o "Book" do próprio MT5 no primeiro dia.
- Dados da B3 recebidos pela sua conta são para **uso pessoal**. Por isso tudo o que chega pela ponte é gravado no seu nome e **só você vê** (nem administradores leem; o banco garante).
- Se o MT5 perder a conexão com a corretora, o robô para de enviar o pulso e o sistema marca a ponte como **desconectada** em até 60 s. Preço parado nunca aparece como atual.

## Instalação

1. **Crie a chave**: no sistema, em *Preferências → MetaTrader 5*, clique em *Criar chave da ponte*. A chave aparece **uma vez só**; copie. (Perdeu? Revogue e crie outra. Máximo de 3 ativas.)
2. **Entre no MT5 com a senha de investidor**, se a Genial fornecer uma (ela só permite consultar, não negociar). O robô funciona com qualquer uma das duas, mas a de investidor é mais segura numa VPS.
3. **Copie o robô**: no MT5, *Arquivo → Abrir pasta de dados → MQL5 → Experts*, cole `WTA_Ponte.mq5`. No *Navegador*, clique com o botão direito em *Expert Advisors → Atualizar*. Na primeira vez o MT5 compila sozinho (ou abra no MetaEditor e tecle F7).
4. **Libere o endereço**: *Ferramentas → Opções → Expert Advisors* → marque *Permitir WebRequest para as URLs listadas* e adicione `https://opcoes.wtatech.com.br`.
   - Use o endereço público com https: o MT5 só faz WebRequest nas portas padrão (80/443), então não dá para chamar `http://api:3001` direto.
5. **Ligue o robô**: arraste `WTA_Ponte` para qualquer gráfico (por exemplo PETR4, M1). Na aba *Entradas*, cole a **Chave**. Mantenha *Algo Trading* ligado (o botão precisa estar verde para o robô rodar; ele continua sem enviar ordens).
6. Confira a aba *Experts* do MT5: deve aparecer `WTA Ponte 1.0.0 iniciada`. No sistema, a ponte passa a "conectada" em poucos segundos.

## Parâmetros

| Parâmetro | Padrão | Para quê |
| --- | --- | --- |
| `UrlBase` | `https://opcoes.wtatech.com.br` | Endereço do sistema |
| `Chave` | (vazio) | Chave da ponte, 43 caracteres |
| `IntervaloMs` | 1500 | Intervalo entre envios de cotações (mínimo 500) |
| `EnviarPosicoes` | sim | Enviar posições abertas |

## Problemas comuns

| Mensagem na aba *Experts* | O que fazer |
| --- | --- |
| `libere o endereço em Ferramentas > Opções...` | Passo 4 |
| `chave recusada` | A chave foi revogada ou colada errada: crie outra e atualize o robô |
| `servidor respondeu 429` | Muitas chaves erradas desse IP: espere 15 minutos |
| `itens descartados pelo servidor: ... horario_fora_do_intervalo` | Relógio da VPS errado: sincronize (NTP) |

## Onde o MT5 roda

Na VPS, 24 h, no contêiner `mt5` da stack (ver `docs/DEPLOYMENT.md`). Você acessa a tela do MT5 pelo navegador (KasmVNC, com senha) só para instalar e conferir; depois ele fica ligado sozinho.
