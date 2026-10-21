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
input int    IntervaloMs     = 1500;                             // Intervalo entre envios de cotações (ms)
input bool   EnviarPosicoes  = true;                             // Enviar posições abertas da conta

#define VERSAO            "1.2.0"
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
int      g_falhasSeguidas = 0;
ulong    g_esperarAte = 0;
int      g_cursor = 0;
int      g_ultimoPedidos = -1, g_ultimoAcompanhados = -1; // para avisar só quando a lista muda          // de onde o próximo lote começa (todos têm vez)
int      g_pendIdx[];           // itens do lote em envio: só contam como enviados depois do 200
long     g_pendMsc[];
double   g_pendBid[], g_pendAsk[], g_pendLast[];

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

   if(agora >= g_proxLista)
     {
      AtualizarLista();
      g_proxLista = agora + LISTA_MS;
     }

   string cotacoes = MontarCotacoes();
   bool pulso = (agora >= g_proxPulso);
   bool posicoes = EnviarPosicoes && (agora >= g_proxPosicoes);
   if(cotacoes == "" && !pulso && !posicoes)
      return;

   string corpo = "{\"versao\":\"" + VERSAO + "\",\"conta\":" + MontarConta() +
                  ",\"cotacoes\":[" + cotacoes + "]";
   if(posicoes)
      corpo += ",\"posicoes\":[" + MontarPosicoes() + "]";
   corpo += "}";

   string resposta;
   int status = Pedir("POST", "/api/ponte/dados", corpo, resposta);
   if(status == 200)
     {
      ConfirmarLote();
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
      string item = "{\"codigo\":\"" + g_ativos[i] + "\"" +
                    ",\"ultimo\":" + Preco(t.last, dig) +
                    ",\"bid\":" + Preco(t.bid, dig) +
                    ",\"ask\":" + Preco(t.ask, dig) +
                    ",\"fechamento_anterior\":" + Preco(FechamentoAnterior(g_ativos[i]), dig) +
                    ",\"volume\":" + (volume > 0 ? IntegerToString((long)volume) : "null") +
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
