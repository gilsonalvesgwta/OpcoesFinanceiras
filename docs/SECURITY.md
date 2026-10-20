# Segurança

## Papéis (RBAC)

| Papel | Escopo | Pode |
| --- | --- | --- |
| `superadmin` | Global | Tudo: usuários e organizações, provedores, limites, parâmetros globais, calendário, manutenção, diagnóstico, registros administrativos |
| `admin` | A própria organização | Convidar, suspender e reativar **usuários comuns** da organização; ver a auditoria da organização. Não muda papéis, não convida nem altera outros admins e não enxerga o superadmin |
| `usuario` | Os próprios dados | Favoritos, regras, posições, simulações, Telegram, preferências |

- Só o superadministrador muda papéis e convida administradores; a mudança fica no registro de auditoria. Um `admin` nunca vira `superadmin` (barrado na api e no banco).
- `admin` não lê posições, regras nem alertas de outros usuários: gestão de acesso não é acesso aos dados financeiros.
- A primeira conta (`SUPERADMIN_EMAIL`, hoje `alves.gilson@yahoo.com.br`) é criada na instalação com senha inicial de uso único.

## Autenticação

- Cadastro **só por convite** ou aprovação administrativa; não há cadastro público.
- Senha com no mínimo 12 caracteres; guardada com `scrypt` do Node (sal por usuário, parâmetros N=2^15, r=8, p=1), nunca em texto puro.
- Sessão: token aleatório de 32 bytes em cookie `HttpOnly`, `Secure`, `SameSite=Lax`; no banco fica só o hash SHA-256 do token. Expira por inatividade (padrão 12 h) e por idade máxima (padrão 30 dias). Logout e suspensão revogam todas as sessões.
- Recuperação de senha por link de uso único (hash no banco, 30 minutos). A resposta é a mesma exista ou não a conta (sem enumeração).
- Tentativas: 8 senhas erradas seguidas para um e-mail = 15 minutos de espera (nem a senha certa entra); 30 falhas por IP = 15 minutos; 10 pedidos de recuperação por IP = 15 minutos. Contadores no banco (sobrevivem a reinício).
- Login de e-mail inexistente gasta o mesmo tempo (hash de enfeite) e dá a mesma resposta que senha errada.
- Links de convite e de recuperação levam o token depois de `#`, que o navegador não envia ao servidor nem grava em registros de acesso.
- Autenticação em dois fatores (TOTP) opcional, prevista para a Fase 9.

## Autorização e isolamento

- Toda rota da `api` declara a política exigida (`publica`, `autenticado`, `admin_da_organizacao`, `superadmin`); rota sem política não sobe (teste automático confere).
- Todo registro de dados do usuário tem `owner_id` e `organization_id`.
- Duas barreiras: a `api` filtra por dono em toda consulta e o PostgreSQL aplica segurança por linha (RLS) com `app.user_id` definido por transação. O papel do banco usado pela aplicação (`wtaopt_app`) não é dono das tabelas e não ignora RLS. As regras exigem conta **ativa** (`app.eu()`): conta suspensa não enxerga nada nem com o id definido.
- O hash da senha não é legível pela aplicação; só a função de login o confere. Pela aplicação, só o próprio usuário troca a própria senha (gatilho no banco).
- Trocar a senha ou ser suspenso derruba todas as sessões (gatilho no banco).
- A checagem de acesso roda antes de o servidor ler o corpo do pedido.
- Testes específicos de isolamento: o usuário B não lê, altera nem apaga nada do usuário A, por nenhuma rota (ver `TEST_PLAN.md`).

## Entradas e saídas

- Toda entrada validada por esquema (corpo, parâmetros, consulta); campos desconhecidos recusados.
- SQL só com parâmetros; nenhum texto do usuário montado em consulta.
- CSRF: `SameSite=Lax` e, em toda requisição que altera dados, cabeçalho `X-CSRF-Token` conferido contra o valor da sessão.
- CORS: só a origem da própria interface.
- Cabeçalhos: CSP restrita, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `frame-ancestors 'none'`.
- Mensagens do Telegram montadas com escape de HTML.

## Segredos

- Nada de segredo no Git. `.env.example` só com nomes.
- Chave da brapi e token do bot do Telegram ficam só na `api` e no `worker`; nunca chegam ao navegador.
- Logs estruturados com lista de campos mascarados (senha, token, cookie, chave, `Authorization`).
- Rotação: trocar a variável na stack e atualizar; sessões continuam válidas porque não dependem dessas chaves.

## Coleta de dados de mercado

- O worker usa o papel `wtaopt_coleta`: lê o calendário e escreve só fechamentos, séries de opções, Selic, registro de importações e o próprio pulso. Não lê usuários, favoritos nem dados da ponte MT5 (testado em `db/tests/mercado.sql`).
- Dados de mercado gratuitos são públicos: qualquer conta ativa lê; a aplicação não escreve neles. Calendário: só o superadministrador altera, com auditoria. Diagnóstico: só o superadministrador lê.
- Arquivo da B3: tamanho limitado (150 MB baixado, 400 MB descompactado), conferência de CRC, linha com preço que não fecha em centavo é recusada e contada.

## Ponte com o MetaTrader 5

- O robô se identifica com uma **chave da ponte** (32 bytes aleatórios), criada pelo próprio usuário e mostrada uma única vez; o banco guarda só o hash SHA-256. Até 3 ativas por usuário; revogar derruba na hora.
- Rotas do robô (`/api/ponte/simbolos`, `/api/ponte/dados`) não usam cookie: só `Authorization: Bearer`. Chave errada conta falha por IP (30 em 15 minutos bloqueiam o IP).
- O robô só alcança funções `security definer` que conferem a chave e gravam **no nome do dono**; a aplicação não grava cotação nem posição da ponte direto nas tabelas.
- Dado da ponte é só do dono (RLS), nem administrador lê. Dono suspenso: a chave para de funcionar.
- Lote validado antes do banco: tamanho máximo, códigos, preços em centavos exatos, horário entre 7 dias atrás e 60 s à frente.
- Só leitura: o robô não usa função de negociação e não existe rota de ordem. Recomendado entrar no MT5 com a senha de investidor.
- A tela do MT5 (KasmVNC) fica atrás do Traefik com HTTPS e senha; a porta RPyC do contêiner não é publicada.

## Telegram

- Vínculo por código temporário: o usuário gera em Preferências um código de uso único (8 caracteres, 15 minutos, só o hash fica no banco) e abre `t.me/<bot>?start=<código>`. O chat fica ligado à conta que gerou o código. Só conversas privadas.
- Um chat só é ligado a uma conta (vincular em outra conta move o chat); desvincular pelo painel ou por /sair.
- O token do bot fica só no worker (`TELEGRAM_BOT_TOKEN`); a api só conhece o nome do bot. O worker não lê as tabelas de avisos e vínculos: usa funções que entregam o mínimo (texto e chat) e marcam o resultado.
- Mensagens com HTML escapado; aviso com mais de 30 minutos não é enviado (preço velho); silêncio respeitado.
- Todo comando confere o `chat_id` contra o vínculo; chat desconhecido recebe só a instrução de vínculo.
- Sugestões proativas só com consentimento explícito, registrado com data.

## Infraestrutura

- PostgreSQL e Redis sem porta publicada, em rede interna da stack.
- Credenciais próprias deste projeto; nenhuma reaproveitada de outra stack.
- Cópias de segurança diárias, com retenção e restauração testada; o arquivo da cópia não sai da VPS sem ação do administrador.
- Endpoints administrativos exigem `superadmin` ou `admin` e ficam no registro de auditoria.

## Auditoria

`audit_logs` registra quem, quando, o quê, antes e depois, para: login e falhas, mudanças de papel, convites, suspensões, configurações, provedores, regras, posições, rolagens e exportações. Registro de auditoria não é editável pela aplicação (só inserção).
