//+------------------------------------------------------------------+
//| WTA_Ponte.mq5                                                    |
//| Ponte SOMENTE LEITURA entre o MetaTrader 5 da corretora e o      |
//| WTA Options Intelligence.                                        |
//|                                                                  |
//| O que faz:                                                       |
//|  - a cada 60 s busca a lista de ativos (favoritos + posições) e  |
//|    os coloca na Observação do Mercado;                           |
//|  - a cada IntervaloMs envia as cotações que mudaram;             |
//|  - a cada 5 s envia um "pulso" (prova de que está vivo);         |
//|  - a cada 10 s envia as posições abertas da conta.               |
//| O que NÃO faz: nunca envia, altera ou cancela ordens. Este       |
//| arquivo não usa nenhuma função de negociação.                    |
//|                                                                  |
//| Instalação: ver ponte-mt5/LEIAME.md                              |
//+------------------------------------------------------------------+
#property copyright "WTA"
#property version   "1.00"
#property description "Envia cotações e posições ao WTA Options Intelligence. Só leitura: não envia ordens."

input string UrlBase         = "https://opcoes.wtatech.com.br"; // Endereço do sistema (https, porta padrão)
input string Chave           = "";                               // Chave da ponte (criada em Preferências)
input int    IntervaloMs     = 1000;                             // Intervalo entre envios de cotações (ms)
input bool   EnviarPosicoes  = true;                             // Enviar posições abertas da conta

#define VERSAO            "1.6.0"
#define TEMPO_LIMITE_MS   10000
#define LOTE_MAX          150   // cotações por envio; o resto vai nos próximos ciclos
#define PULSO_MS          5000
#define POSICOES_MS       10000
#define LISTA_MS          60000
#define MAX_ATIVOS        500

string   g_ativos[];
long     g_ultimoMsc[];     // time_msc da última cotação enviada, por ativo
double   g_ultimoBid[], g_ultimoAsk[], g_ultimoLast[];
ulong    g_proxPulso = 0, g_proxPosicoes = 0, g_proxLista = 0;
bool     g_catalogoFeito = false;   // levantamento das opções da corretora (uma vez)
int      g_falhasSeguidas = 0;
ulong    g_esperarAte = 0;
int      g_cursor = 0;
int      g_ultimoPedidos = -1, g_ultimoAcompanhados = -1; // para avisar só quando a lista muda          // de onde o próximo lote começa (todos têm vez)
int      g_pendIdx[];           // itens do lote em envio: só contam como enviados depois do 200
long     g_pendMsc[];
double   g_pendBid[], g_pendAsk[], g_pendLast[];
// Gráfico do dia: minutos já fechados (barras M1) de ações e ETFs, enviados aos poucos.
string   g_barCod[];          // código
datetime g_barDesde[];        // abertura da última barra M1 confirmada pelo servidor
string   g_pendBarCod[];
datetime g_pendBarAte[];
#define BARRAS_POR_ENVIO  2       // ativos com barras em cada envio
#define DIAS_DE_BARRAS    6       // na primeira vez: até 6 dias corridos (aba 5D)

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(Chave) != 43)
     {
      Alert("WTA Ponte: informe a chave da ponte (43 caracteres), criada em Preferências > MetaTrader 5.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   if(StringFind(UrlBase, "https://") != 0)
      Print("WTA Ponte: aviso - o endereço não é https; a chave viajaria sem criptografia.");
   if(MQLInfoInteger(MQL_TESTER))
     {
      Print("WTA Ponte: não roda no testador de estratégia.");
      return(INIT_FAILED);
     }
   int intervalo = MathMax(IntervaloMs, 500);
   if(!EventSetMillisecondTimer(intervalo))
      return(INIT_FAILED);
   PrintFormat("WTA Ponte %s iniciada: envio a cada %d ms para %s", VERSAO, intervalo, UrlBase);
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

void OnTick() { } // o trabalho é feito no timer: a ponte acompanha vários ativos, não só o do gráfico

//+------------------------------------------------------------------+
void OnTimer()
  {
   ulong agora = GetTickCount64();
   if(agora < g_esperarAte)
      return; // recuo depois de falhas seguidas

   // Sem conexão com a corretora não há o que provar: sem pulso, o sistema marca
   // "desconectado" em até 60 s em vez de exibir preço parado como atual. E não se
   // enviam posições, para uma lista vazia não apagar as posições guardadas.
   if(!TerminalInfoInteger(TERMINAL_CONNECTED) || AccountInfoInteger(ACCOUNT_LOGIN) <= 0)
      return;

   if(!g_catalogoFeito)
     {
      g_catalogoFeito = true;
      CatalogoDaCorretora();
     }

   if(agora >= g_proxLista)
     {
      AtualizarLista();
      g_proxLista = agora + LISTA_MS;
     }

   string cotacoes = MontarCotacoes();
   string barras = MontarBarras();
   bool pulso = (agora >= g_proxPulso);
   bool posicoes = EnviarPosicoes && (agora >= g_proxPosicoes);
   if(cotacoes == "" && barras == "" && !pulso && !posicoes)
      return;

   string corpo = "{\"versao\":\"" + VERSAO + "\",\"conta\":" + MontarConta() +
                  ",\"cotacoes\":[" + cotacoes + "]";
   if(barras != "")
      corpo += ",\"barras\":[" + barras + "]";
   if(posicoes)
      corpo += ",\"posicoes\":[" + MontarPosicoes() + "]";
   corpo += "}";

   string resposta;
   int status = Pedir("POST", "/api/ponte/dados", corpo, resposta);
   if(status == 200)
     {
      ConfirmarLote();
      ConfirmarBarras();
      g_falhasSeguidas = 0;
      g_proxPulso = agora + PULSO_MS;
      if(posicoes)
         g_proxPosicoes = agora + POSICOES_MS;
      if(StringFind(resposta, "\"descartadas\":0") < 0)
         Print("WTA Ponte: itens descartados pelo servidor: ", resposta);
     }
   else
      Falhou(status, resposta);
  }

//+------------------------------------------------------------------+
//| HTTP                                                             |
//+------------------------------------------------------------------+
int Pedir(const string metodo, const string caminho, const string corpo, string &resposta)
  {
   char dados[], recebido[];
   string cabecalhosResposta;
   string cabecalhos = "Authorization: Bearer " + Chave + "\r\nAccept: application/json\r\n";
   if(corpo != "")
     {
      cabecalhos += "Content-Type: application/json\r\n";
      int n = StringToCharArray(corpo, dados, 0, WHOLE_ARRAY, CP_UTF8);
      ArrayResize(dados, MathMax(n - 1, 0)); // tira o zero final da string
     }
   ResetLastError();
   int status = WebRequest(metodo, UrlBase + caminho, cabecalhos, TEMPO_LIMITE_MS, dados, recebido, cabecalhosResposta);
   resposta = CharArrayToString(recebido, 0, WHOLE_ARRAY, CP_UTF8);
   if(status == -1)
     {
      int erro = GetLastError();
      if(erro == 4014)
         Print("WTA Ponte: libere o endereço em Ferramentas > Opções > Expert Advisors > 'Permitir WebRequest para as URLs listadas': ", UrlBase);
      else
         Print("WTA Ponte: falha de rede, erro ", erro);
     }
   return(status);
  }

void Falhou(const int status, const string resposta)
  {
   g_falhasSeguidas++;
   if(status == 401)
      Print("WTA Ponte: chave recusada (revogada ou errada). Crie outra em Preferências e atualize o robô.");
   else
      if(status != -1)
         Print("WTA Ponte: servidor respondeu ", status, " ", StringSubstr(resposta, 0, 200));
   // Recuo: 2 s, 4 s, 8 s ... até 60 s. Chave recusada espera sempre 60 s (evita bloqueio por IP).
   int espera = (status == 401 || status == 429) ? 60000 : (int)MathMin(60000, 1000 * MathPow(2, MathMin(g_falhasSeguidas, 6)));
   g_esperarAte = GetTickCount64() + espera;
  }

//+------------------------------------------------------------------+
//| Lista de ativos                                                  |
//+------------------------------------------------------------------+
void AtualizarLista()
  {
   string resposta;
   int status = Pedir("GET", "/api/ponte/simbolos", "", resposta);
   if(status != 200)
     {
      Falhou(status, resposta);
      return;
     }
   string novos[];
   LerListaJson(resposta, novos);
   int n = 0;
   string faltam = "";
   int naoAchados = 0;
   string antigos[];
   ArrayCopy(antigos, g_ativos);
   ArrayResize(g_ativos, 0);
   for(int i = 0; i < ArraySize(novos) && n < MAX_ATIVOS; i++)
     {
      if(!SymbolSelect(novos[i], true)) // não existe nesta corretora: ignora
        {
         naoAchados++;
         if(naoAchados <= 8)
            faltam += (faltam == "" ? "" : ", ") + novos[i];
         continue;
        }
      ArrayResize(g_ativos, n + 1);
      g_ativos[n++] = novos[i];
     }
   // Ativo novo na lista começa "nunca enviado".
   long msc[]; double b[], a[], l[];
   ArrayResize(msc, n); ArrayResize(b, n); ArrayResize(a, n); ArrayResize(l, n);
   for(int i = 0; i < n; i++)
     {
      msc[i] = 0; b[i] = -1; a[i] = -1; l[i] = -1;
      for(int j = 0; j < ArraySize(antigos); j++)
         if(antigos[j] == g_ativos[i] && j < ArraySize(g_ultimoMsc))
           { msc[i] = g_ultimoMsc[j]; b[i] = g_ultimoBid[j]; a[i] = g_ultimoAsk[j]; l[i] = g_ultimoLast[j]; break; }
     }
   ArrayCopy(g_ultimoMsc, msc); ArrayResize(g_ultimoMsc, n);
   ArrayCopy(g_ultimoBid, b);   ArrayResize(g_ultimoBid, n);
   ArrayCopy(g_ultimoAsk, a);   ArrayResize(g_ultimoAsk, n);
   ArrayCopy(g_ultimoLast, l);  ArrayResize(g_ultimoLast, n);
   if(ArraySize(novos) != g_ultimoPedidos || n != g_ultimoAcompanhados)
     {
      PrintFormat("WTA Ponte: lista com %d ativos, %d acompanhados%s", ArraySize(novos), n,
                  naoAchados > 0 ? StringFormat("; %d não existem nesta corretora (ex.: %s)", naoAchados, faltam) : "");
      g_ultimoPedidos = ArraySize(novos);
      g_ultimoAcompanhados = n;
     }
  }

// Lê {"simbolos":["PETR4","VALE3"]} sem biblioteca de JSON (os códigos só têm A-Z e 0-9).
void LerListaJson(const string json, string &saida[])
  {
   ArrayResize(saida, 0);
   int ini = StringFind(json, "[");
   int fim = StringFind(json, "]", ini + 1);
   if(ini < 0 || fim < 0)
      return;
   string miolo = StringSubstr(json, ini + 1, fim - ini - 1);
   StringReplace(miolo, "\"", "");
   StringReplace(miolo, " ", "");
   string partes[];
   int n = StringSplit(miolo, ',', partes);
   for(int i = 0; i < n; i++)
      if(StringLen(partes[i]) >= 4 && StringLen(partes[i]) <= 16)
        {
         int k = ArraySize(saida);
         ArrayResize(saida, k + 1);
         saida[k] = partes[i];
        }
  }

//+------------------------------------------------------------------+
//| Montagem do JSON                                                 |
//+------------------------------------------------------------------+
// Diferença entre o relógio do servidor da corretora e o UTC, arredondada a 15 min.
long DeslocamentoMs()
  {
   long seg = (long)(TimeTradeServer() - TimeGMT());
   return(((long)MathRound(seg / 900.0)) * 900 * 1000);
  }

string Preco(const double v, const int digitos)
  {
   if(v <= 0.0)
      return("null"); // zero no MT5 = sem dado (livro vazio, sem negócio)
   return(DoubleToString(v, digitos));
  }

// Fechamento do último pregão ANTERIOR ao de hoje.
double FechamentoAnterior(const string ativo)
  {
   datetime hoje = iTime(ativo, PERIOD_D1, 0);
   if(hoje == 0)
      return(0.0);
   MqlDateTime d0, srv;
   TimeToStruct(hoje, d0);
   TimeToStruct(TimeTradeServer(), srv);
   int indice = (d0.year == srv.year && d0.day_of_year == srv.day_of_year) ? 1 : 0;
   return(iClose(ativo, PERIOD_D1, indice));
  }

// Monta até LOTE_MAX cotações que mudaram, começando de onde o lote anterior parou.
// Só depois que o servidor confirma (ConfirmarLote) elas contam como enviadas: se o envio
// falhar, vão de novo no próximo ciclo, mesmo que o preço não mude mais (opção pouco negociada).
// Abertura, máxima e mínima da barra diária de HOJE (0 se a barra de hoje ainda não existe).
void BarraDeHoje(const string ativo, double &abertura, double &maxima, double &minima)
  {
   abertura = 0.0; maxima = 0.0; minima = 0.0;
   datetime hoje = iTime(ativo, PERIOD_D1, 0);
   if(hoje == 0)
      return;
   MqlDateTime d0, srv;
   TimeToStruct(hoje, d0);
   TimeToStruct(TimeTradeServer(), srv);
   if(d0.year != srv.year || d0.day_of_year != srv.day_of_year)
      return;
   abertura = iOpen(ativo, PERIOD_D1, 0);
   maxima = iHigh(ativo, PERIOD_D1, 0);
   minima = iLow(ativo, PERIOD_D1, 0);
  }

string MontarCotacoes()
  {
   string s = "";
   ArrayResize(g_pendIdx, 0); ArrayResize(g_pendMsc, 0);
   ArrayResize(g_pendBid, 0); ArrayResize(g_pendAsk, 0); ArrayResize(g_pendLast, 0);
   int total = ArraySize(g_ativos);
   if(total == 0)
      return(s);
   if(g_cursor >= total)
      g_cursor = 0;
   long desloc = DeslocamentoMs();
   int n = 0;
   int i = g_cursor;
   for(int passo = 0; passo < total && n < LOTE_MAX; passo++, i = (i + 1) % total)
     {
      MqlTick t;
      if(!SymbolInfoTick(g_ativos[i], t) || t.time_msc == 0)
         continue;
      if(t.time_msc == g_ultimoMsc[i] && t.bid == g_ultimoBid[i] && t.ask == g_ultimoAsk[i] && t.last == g_ultimoLast[i])
         continue; // nada mudou
      int dig = (int)SymbolInfoInteger(g_ativos[i], SYMBOL_DIGITS);
      double volume = SymbolInfoDouble(g_ativos[i], SYMBOL_SESSION_VOLUME);
      long lote = (long)MathRound(SymbolInfoDouble(g_ativos[i], SYMBOL_VOLUME_STEP)); // passo de quantidade (1 ou 100 na B3)
      double ab, mx, mn;
      BarraDeHoje(g_ativos[i], ab, mx, mn);
      string item = "{\"codigo\":\"" + g_ativos[i] + "\"" +
                    ",\"ultimo\":" + Preco(t.last, dig) +
                    ",\"bid\":" + Preco(t.bid, dig) +
                    ",\"ask\":" + Preco(t.ask, dig) +
                    ",\"fechamento_anterior\":" + Preco(FechamentoAnterior(g_ativos[i]), dig) +
                    ",\"volume\":" + (volume > 0 ? IntegerToString((long)volume) : "null") +
                    ",\"lote\":" + (lote >= 1 ? IntegerToString(lote) : "null") +
                    ",\"abertura\":" + Preco(ab, dig) +
                    ",\"maxima\":" + Preco(mx, dig) +
                    ",\"minima\":" + Preco(mn, dig) +
                    ",\"instante\":" + IntegerToString(t.time_msc - desloc) + "}";
      s += (s == "" ? "" : ",") + item;
      ArrayResize(g_pendIdx, n + 1); ArrayResize(g_pendMsc, n + 1);
      ArrayResize(g_pendBid, n + 1); ArrayResize(g_pendAsk, n + 1); ArrayResize(g_pendLast, n + 1);
      g_pendIdx[n] = i; g_pendMsc[n] = t.time_msc; g_pendBid[n] = t.bid; g_pendAsk[n] = t.ask; g_pendLast[n] = t.last;
      n++;
     }
   g_cursor = i;
   return(s);
  }

// Opção da B3: 4 letras do ativo + letra do mês (A–X) + números, com "E" opcional e,
// nas semanais, "W1".."W5" no fim. Devolve 0 = não é opção, 1 = mensal, 2 = semanal.
int TipoDeOpcao(const string c)
  {
   int n = StringLen(c);
   if(n < 7 || n > 12)
      return(0);
   for(int i = 0; i < 4; i++)
     {
      ushort ch = StringGetCharacter(c, i);
      if(ch < 'A' || ch > 'Z')
         return(0);
     }
   ushort mes = StringGetCharacter(c, 4);
   if(mes < 'A' || mes > 'X')
      return(0);
   ushort d = StringGetCharacter(c, 5);
   if(d < '0' || d > '9')
      return(0);
   if(n >= 8 && StringGetCharacter(c, n - 2) == 'W')
     {
      ushort w = StringGetCharacter(c, n - 1);
      if(w >= '1' && w <= '5')
         return(2);
     }
   return(1);
  }

// Levantamento de TODAS as opções que a corretora oferece no MT5 (mensais e semanais),
// escrito no Experts. Serve para conferir com precisão quais ativos têm semanais aqui.
void CatalogoDaCorretora()
  {
   string raiz[];
   int mensais[], semanais[];
   int totalM = 0, totalS = 0;
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
     {
      string c = SymbolName(i, false);
      int t = TipoDeOpcao(c);
      if(t == 0)
         continue;
      string r = StringSubstr(c, 0, 4);
      int k = -1;
      for(int j = 0; j < ArraySize(raiz); j++)
         if(raiz[j] == r) { k = j; break; }
      if(k < 0)
        {
         k = ArraySize(raiz);
         ArrayResize(raiz, k + 1); ArrayResize(mensais, k + 1); ArrayResize(semanais, k + 1);
         raiz[k] = r; mensais[k] = 0; semanais[k] = 0;
        }
      if(t == 1) { mensais[k]++; totalM++; }
      else { semanais[k]++; totalS++; }
     }
   PrintFormat("WTA Ponte: catálogo da corretora: %d símbolos, %d opções mensais e %d semanais (em %d ativos)", total, totalM, totalS, ArraySize(raiz));
   string principais[] = {"BOVA", "PETR", "VALE", "BBAS", "ITUB", "BBDC", "ABEV", "B3SA", "PRIO", "SUZB"};
   string linha = "";
   for(int p = 0; p < ArraySize(principais); p++)
     {
      int m = 0, s2 = 0;
      for(int j = 0; j < ArraySize(raiz); j++)
         if(raiz[j] == principais[p]) { m = mensais[j]; s2 = semanais[j]; break; }
      linha += (linha == "" ? "" : " | ") + principais[p] + " " + IntegerToString(m) + "M/" + IntegerToString(s2) + "S";
     }
   Print("WTA Ponte: opções por ativo (M = mensais, S = semanais): ", linha);
   string comSemanais = "";
   int n = 0;
   for(int j = 0; j < ArraySize(raiz) && n < 20; j++)
      if(semanais[j] > 0) { comSemanais += (comSemanais == "" ? "" : ", ") + raiz[j] + " " + IntegerToString(semanais[j]); n++; }
   Print("WTA Ponte: ativos com semanais nesta corretora: ", comSemanais == "" ? "nenhum" : comSemanais);
  }

// Ação ou ETF (4 letras + 1 ou 2 dígitos, ex.: PETR4, BOVA11); opções ficam de fora.
bool EhAcao(const string c)
  {
   int n = StringLen(c);
   if(n < 5 || n > 6)
      return(false);
   for(int i = 0; i < n; i++)
     {
      ushort ch = StringGetCharacter(c, i);
      if(i < 4 && (ch < 'A' || ch > 'Z'))
         return(false);
      if(i >= 4 && (ch < '0' || ch > '9'))
         return(false);
     }
   return(true);
  }

int IndiceDaBarra(const string c)
  {
   for(int i = 0; i < ArraySize(g_barCod); i++)
      if(g_barCod[i] == c)
         return(i);
   return(-1);
  }

// Minutos fechados (barras M1) ainda não enviados: na primeira vez, os últimos dias;
// depois, só os novos. Fica pendente até o servidor confirmar.
string MontarBarras()
  {
   string s = "";
   ArrayResize(g_pendBarCod, 0);
   ArrayResize(g_pendBarAte, 0);
   long desloc = DeslocamentoMs();
   int feitos = 0;
   for(int i = 0; i < ArraySize(g_ativos) && feitos < BARRAS_POR_ENVIO; i++)
     {
      string c = g_ativos[i];
      if(!EhAcao(c))
         continue;
      datetime atual = iTime(c, PERIOD_M1, 0);
      if(atual == 0)
         continue;
      int k = IndiceDaBarra(c);
      datetime desde = (k >= 0) ? g_barDesde[k] : 0;
      datetime ultimaFechada = atual - 60;
      if(desde >= ultimaFechada)
         continue;
      datetime de = (desde > 0) ? desde + 60 : atual - DIAS_DE_BARRAS * 86400;
      MqlRates r[];
      int n = CopyRates(c, PERIOD_M1, de, ultimaFechada, r);
      if(n <= 0)
         continue; // histórico ainda carregando: tenta no próximo ciclo
      int ini = MathMax(0, n - 3000);
      int dig = (int)SymbolInfoInteger(c, SYMBOL_DIGITS);
      string pts = "";
      for(int j = ini; j < n; j++)
        {
         if(r[j].close <= 0.0)
            continue;
         pts += (pts == "" ? "" : ",") + "[" + IntegerToString((long)r[j].time * 1000 - desloc) + "," + DoubleToString(r[j].close, dig) + "]";
        }
      int m = ArraySize(g_pendBarCod);
      ArrayResize(g_pendBarCod, m + 1);
      ArrayResize(g_pendBarAte, m + 1);
      g_pendBarCod[m] = c;
      g_pendBarAte[m] = r[n - 1].time;
      if(pts != "")
         s += (s == "" ? "" : ",") + "{\"codigo\":\"" + c + "\",\"pontos\":[" + pts + "]}";
      feitos++;
     }
   return(s);
  }

void ConfirmarBarras()
  {
   for(int m = 0; m < ArraySize(g_pendBarCod); m++)
     {
      int k = IndiceDaBarra(g_pendBarCod[m]);
      if(k < 0)
        {
         k = ArraySize(g_barCod);
         ArrayResize(g_barCod, k + 1);
         ArrayResize(g_barDesde, k + 1);
         g_barCod[k] = g_pendBarCod[m];
        }
      g_barDesde[k] = g_pendBarAte[m];
     }
   ArrayResize(g_pendBarCod, 0);
  }

void ConfirmarLote()
  {
   for(int k = 0; k < ArraySize(g_pendIdx); k++)
     {
      int i = g_pendIdx[k];
      if(i >= ArraySize(g_ultimoMsc))
         continue;
      g_ultimoMsc[i] = g_pendMsc[k]; g_ultimoBid[i] = g_pendBid[k]; g_ultimoAsk[i] = g_pendAsk[k]; g_ultimoLast[i] = g_pendLast[k];
     }
   ArrayResize(g_pendIdx, 0);
  }

string Texto(const string v)
  {
   string r = v;
   StringReplace(r, "\\", "\\\\");
   StringReplace(r, "\"", "\\\"");
   return("\"" + r + "\"");
  }

string MontarConta()
  {
   return("{\"login\":" + Texto(IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))) +
          ",\"servidor\":" + Texto(AccountInfoString(ACCOUNT_SERVER)) +
          ",\"corretora\":" + Texto(AccountInfoString(ACCOUNT_COMPANY)) + "}");
  }

// Só leitura: PositionGetSymbol / PositionGet* apenas consultam a posição.
string MontarPosicoes()
  {
   string s = "";
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      string ativo = PositionGetSymbol(i);
      if(ativo == "")
         continue;
      long tipo = PositionGetInteger(POSITION_TYPE);
      long quantidade = (long)MathRound(PositionGetDouble(POSITION_VOLUME));
      double preco = PositionGetDouble(POSITION_PRICE_OPEN);
      if(quantidade <= 0)
         continue;
      string item = "{\"codigo\":\"" + ativo + "\"" +
                    ",\"lado\":\"" + (tipo == POSITION_TYPE_BUY ? "compra" : "venda") + "\"" +
                    ",\"quantidade\":" + IntegerToString(quantidade) +
                    ",\"preco_medio\":" + DoubleToString(preco, 6) + "}";
      s += (s == "" ? "" : ",") + item;
     }
   return(s);
  }
//+------------------------------------------------------------------+
