'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Cabecalho } from '../../componentes/Casca.tsx';
import { Icone, Seta } from '../../componentes/Icone.tsx';
import { ReguaDoPregao } from '../../componentes/Regua.tsx';
import { useConsultaPeriodica } from '../../componentes/Consulta.tsx';
import { chamar, type Favorito } from '../../lib/api.ts';
import { diasAte, formatarData, formatarDataLonga, formatarReais, formatarVariacao } from '../../lib/formatos.ts';
import {
  contaDaPonte, detalheDaCotacao, encerrarAgora, formatarPreco, formatarPrecoMedio, formatarResultado, haQuanto, horaExata,
  SELO_DA_QUALIDADE, variacaoDoDia, type CotacaoDaApi, type Ponte, type PosicaoDaCorretora,
} from '../../lib/ponte.ts';
import { emBrasilia } from '../../lib/regua.ts';
import { proximosVencimentos } from '../../lib/vencimentos.ts';

function quando(dias: number): string {
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  return `em ${dias} dias`;
}

export default function Painel() {
  const [hoje, setHoje] = useState<Date | null>(null);
  const [favoritos, setFavoritos] = useState<Favorito[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setHoje(new Date());
    chamar<{ favoritos: Favorito[] }>('GET', '/api/favoritos')
      .then((r) => setFavoritos(r.favoritos))
      .catch((e: Error) => setErro(e.message));
  }, []);

  const cotacoes = useConsultaPeriodica<{ cotacoes: CotacaoDaApi[] }>('/api/cotacoes', 3_000).dados?.cotacoes ?? [];
  const pontes = useConsultaPeriodica<{ pontes: Ponte[] }>('/api/ponte', 10_000).dados?.pontes;
  const posicoes = useConsultaPeriodica<{ posicoes: PosicaoDaCorretora[] }>('/api/posicoes-corretora', 10_000).dados?.posicoes;
  const agora = new Date();

  const ativas = pontes?.filter((p) => !p.revogadaEm) ?? [];
  const ponte = ativas.find((p) => p.estado === 'tempo_real' || p.estado === 'historico') ?? ativas[0];
  const aoVivo = ponte?.estado === 'tempo_real';
  const conectada = ponte !== undefined && (ponte.estado === 'tempo_real' || ponte.estado === 'historico');
  const porCodigo = new Map(cotacoes.map((c) => [c.codigo, c]));
  // Acompanhados = favoritos + o que está em posição na corretora (o robô acompanha os dois).
  const codigos = favoritos === null ? [] : [...favoritos.map((f) => f.codigo), ...cotacoes.map((c) => c.codigo).filter((c) => !favoritos.some((f) => f.codigo === c))];
  const soEmPosicao = new Set(codigos.filter((c) => !favoritos?.some((f) => f.codigo === c)));
  const lidasEm = posicoes?.reduce<string | null>((m, p) => (p.recebidoEm && (!m || p.recebidoEm > m) ? p.recebidoEm : m), null) ?? null;

  const dia = hoje ? emBrasilia(hoje).dia : null;
  const vencimentos = dia ? proximosVencimentos(dia) : [];

  return (
    <>
      <Cabecalho
        titulo="Painel"
        apoio={hoje ? formatarDataLonga(hoje) : ' '}
        acoes={
          <>
            <Link href="/ativos" className="botao">Adicionar ativo</Link>
            <Link href="/alertas" className="botao botao-principal">Criar regra de alerta</Link>
          </>
        }
      />

      <section className="secao" aria-labelledby="regua-titulo" style={{ gap: 16 }}>
        <ReguaDoPregao aoVivo={aoVivo} />
        <div className="fontes">
          {ponte ? (
            <div className="fonte">
              <span className={conectada ? 'selo-vivo' : ponte.ultimoContatoEm ? 'selo-atencao' : 'selo-neutro'} style={{ display: 'inline-flex', paddingTop: 2 }}>
                <Icone nome={conectada ? 'diagnostico' : 'aviso'} />
              </span>
              <span>
                {conectada ? (
                  <>
                    <span className="fonte-titulo">Seus ativos: tempo real pelo MetaTrader 5</span>
                    <span className="fonte-texto">{contaDaPonte(ponte)}. Último sinal da ponte {haQuanto(ponte.ultimoContatoEm, agora)}.</span>
                  </>
                ) : ponte.ultimoContatoEm ? (
                  <>
                    <span className="fonte-titulo">MetaTrader 5 sem sinal</span>
                    <span className="fonte-texto">Último sinal {haQuanto(ponte.ultimoContatoEm, agora)}. Confira se o MetaTrader 5 está aberto e conectado à corretora.</span>
                  </>
                ) : (
                  <>
                    <span className="fonte-titulo">MetaTrader 5 aguardando o primeiro sinal</span>
                    <span className="fonte-texto">Cole a chave da ponte no robô. <Link href="/preferencias#metatrader">Ver o passo a passo</Link></span>
                  </>
                )}
              </span>
            </div>
          ) : (
            <div className="fonte">
              <span style={{ color: 'var(--apoio)', display: 'inline-flex', paddingTop: 2 }}><Icone nome="relogio" /></span>
              <span>
                <span className="fonte-titulo">Ações: sem cotações ainda</span>
                <span className="fonte-texto">
                  Para tempo real, ligue o MetaTrader 5 da sua corretora em <Link href="/preferencias#metatrader">Preferências</Link>. A coleta gratuita pela brapi (a cada 30 minutos) começa na próxima etapa.
                </span>
              </span>
            </div>
          )}
          <div className="fonte">
            <span style={{ color: 'var(--apoio)', display: 'inline-flex', paddingTop: 2 }}><Icone nome="calendario" /></span>
            <span>
              <span className="fonte-titulo">Cadeia completa de opções: sem arquivo da B3 ainda</span>
              <span className="fonte-texto">
                O fechamento diário de todas as séries entra na próxima etapa.{ponte ? ' As opções que você acompanha ou tem em posição vêm do MetaTrader 5.' : ' Feriados também.'}
              </span>
            </span>
          </div>
        </div>
      </section>

      <div className="grade-2">
        <section className="secao secao-tabela" aria-labelledby="ativos-titulo">
          <div className="secao-topo">
            <h2 id="ativos-titulo">Ativos acompanhados</h2>
            <Link href="/ativos" style={{ fontSize: 14, padding: '10px 0' }}>Gerenciar</Link>
          </div>
          {erro && <p className="secao-vazia" style={{ padding: '0 24px' }} role="alert">{erro}</p>}
          {favoritos === null && !erro && <p className="secao-vazia" style={{ padding: '0 24px 12px' }} role="status">Carregando…</p>}
          {favoritos?.length === 0 && (
            <div style={{ padding: '0 24px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p className="secao-vazia">Você ainda não acompanha nenhum ativo. Adicione os códigos que você opera, como PETR4 ou BOVA11.</p>
              <div><Link href="/ativos" className="botao botao-contorno">Adicionar ativo</Link></div>
            </div>
          )}
          {codigos.length > 0 && (
            <div className="tabela-caixa">
              <table className="tabela">
                <thead>
                  <tr>
                    <th scope="col">Ativo</th>
                    <th scope="col" className="numero">Último</th>
                    <th scope="col" className="numero">Compra</th>
                    <th scope="col" className="numero">Venda</th>
                    <th scope="col" className="numero">Dia</th>
                    <th scope="col">Dado</th>
                  </tr>
                </thead>
                <tbody>
                  {codigos.map((codigo) => {
                    const c = porCodigo.get(codigo);
                    const selo = SELO_DA_QUALIDADE[c?.qualidade ?? 'indisponivel'];
                    const variacao = c ? variacaoDoDia(c) : null;
                    return (
                      <tr key={codigo}>
                        <th scope="row">
                          {codigo}
                          {soEmPosicao.has(codigo) && <span className="sub">em posição na corretora</span>}
                        </th>
                        <td className="numero" style={{ fontWeight: 600 }}>{formatarReais(c?.ultimo ?? null)}</td>
                        <td className="numero" style={{ color: 'var(--apoio)' }}>{formatarPreco(c?.bid ?? null)}</td>
                        <td className="numero" style={{ color: 'var(--apoio)' }}>{formatarPreco(c?.ask ?? null)}</td>
                        <td className="numero">
                          {variacao === null ? <span aria-label="sem variação">—</span> : (
                            <span className={variacao >= 0 ? 'selo selo-alta' : 'selo selo-baixa'}>
                              <Seta sobe={variacao >= 0} />{formatarVariacao(variacao)}
                            </span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className={`selo ${selo.classe}`}><Icone nome={selo.icone} tamanho={selo.preenchido ? 14 : 16} preenchido={selo.preenchido ?? false} />{selo.texto}</span>
                          {c && <span className="sub">{detalheDaCotacao(c, agora)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="coluna">
          <section className="secao" aria-labelledby="venc-titulo">
            <h2 id="venc-titulo">Próximos vencimentos de opções</h2>
            {dia && vencimentos.map((v) => (
              <div key={v} className="linha-lista">
                <span>
                  <span className="linha-lista-grande">{formatarData(v)}</span>
                  <span className="linha-lista-apoio">Vencimento mensal previsto</span>
                </span>
                <span className="linha-lista-apoio">{quando(diasAte(dia, v))}</span>
              </div>
            ))}
            <span className="linha-lista-apoio" style={{ fontSize: 13 }}>
              Previsão pela terceira sexta-feira do mês, ainda sem descontar feriados. A data oficial de cada série vem da B3.
            </span>
          </section>

          <section className="secao" aria-labelledby="alertas-titulo">
            <h2 id="alertas-titulo">Alertas</h2>
            <p className="secao-vazia">Você ainda não tem regras de alerta. Crie uma para ser avisado no Telegram quando um preço cruzar o nível que você escolher.</p>
            <div><Link href="/alertas" className="botao botao-contorno">Criar regra de alerta</Link></div>
          </section>

          <section className="secao" aria-labelledby="pos-titulo">
            <h2 id="pos-titulo">Posições abertas</h2>
            <p className="secao-vazia">Nenhuma posição registrada. Registre uma operação que você fez na corretora para acompanhar resultado, risco e rolagens.</p>
            <div><Link href="/posicoes" className="botao">Registrar operação</Link></div>
          </section>
        </div>
      </div>
      {ponte && (
        <section className="secao secao-tabela" aria-labelledby="corretora-titulo">
          <div className="secao-topo">
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <h2 id="corretora-titulo">Posições na corretora</h2>
              <span style={{ color: 'var(--apoio)', fontSize: 14 }}>
                {contaDaPonte(ponte)}.{lidasEm ? ` Lidas do MetaTrader 5 às ${horaExata(lidasEm)}, só leitura.` : ' Só leitura.'}
                {!conectada && ponte.ultimoContatoEm && ' A ponte está sem sinal: estas posições podem estar desatualizadas.'}
              </span>
            </span>
            <span style={{ color: 'var(--apoio)', fontSize: 14 }}>Só você vê estes dados.</span>
          </div>
          {posicoes && posicoes.length === 0 && (
            <p className="secao-vazia" style={{ padding: '0 24px 12px' }}>
              {ponte.ultimoContatoEm ? 'Nenhuma posição aberta na conta.' : 'As posições aparecem aqui quando o robô mandar o primeiro sinal.'}
            </p>
          )}
          {posicoes && posicoes.length > 0 && (
            <>
              <div className="tabela-caixa">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th scope="col">Ativo</th>
                      <th scope="col">Lado</th>
                      <th scope="col" className="numero">Quantidade</th>
                      <th scope="col" className="numero">Preço médio</th>
                      <th scope="col" className="numero">Para encerrar agora</th>
                      <th scope="col" className="numero">Resultado estimado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {posicoes.map((p) => {
                      const e = encerrarAgora(p, porCodigo.get(p.codigo));
                      return (
                        <tr key={p.codigo}>
                          <th scope="row">{p.codigo}</th>
                          <td>{p.lado === 'compra' ? 'Comprado' : 'Vendido'}</td>
                          <td className="numero">{p.quantidade.toLocaleString('pt-BR')}</td>
                          <td className="numero">{formatarPrecoMedio(p.precoMedio)}</td>
                          <td className="numero">
                            {e.ok ? formatarReais(e.preco) : '—'}
                            <span className="sub">{e.ok ? e.origem : e.motivo}</span>
                          </td>
                          <td className="numero">
                            {e.ok ? <span className={e.resultado >= 0 ? 'resultado-alta' : 'resultado-baixa'}>{formatarResultado(e.resultado)}</span> : <span aria-label="sem estimativa">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="secao-vazia" style={{ padding: '8px 24px 12px', fontSize: 14 }}>
                Resultado estimado = quanto daria encerrar agora: comprado vende pela melhor oferta de compra, vendido recompra pela melhor oferta de venda. Sem custos e impostos. Para acompanhar risco, vencimento e rolagens, estas posições poderão ser importadas em Posições (Fase 6).
              </p>
            </>
          )}
        </section>
      )}
    </>
  );
}
