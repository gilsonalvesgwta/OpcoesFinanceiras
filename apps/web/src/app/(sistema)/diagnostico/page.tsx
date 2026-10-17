'use client';

// Diagnóstico (superadministrador): de onde vêm os dados e se estão em dia.
// Conforme a prévia aprovada em 17/10/2026.

import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { useConsultaPeriodica } from '../../../componentes/Consulta.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { useSessao } from '../../../componentes/Sessao.tsx';
import {
  cartaoDaBrapi, cartaoDaColeta, cartaoDaSelic, cartaoDoFechamento, linhaDaTentativa, numero,
  type Cartao, type Diagnostico, type SituacaoDoMercado,
} from '../../../lib/mercado.ts';
import { estadoDaPonte, haQuanto, type Ponte } from '../../../lib/ponte.ts';

function cartaoDoMt5(pontes: Ponte[] | undefined, agora: Date): Cartao {
  const ativas = pontes?.filter((p) => !p.revogadaEm) ?? [];
  const p = ativas.find((x) => x.estado === 'tempo_real' || x.estado === 'historico') ?? ativas[0];
  if (!p) return { nome: 'MetaTrader 5 (Genial)', estado: 'Não ligado', classe: 'selo-neutro', icone: 'indisponivel', texto: 'Crie a chave da ponte em Preferências para ter preço em tempo real.' };
  const e = estadoDaPonte(p);
  return {
    nome: 'MetaTrader 5 (Genial)', estado: e.texto, classe: e.classe, icone: 'ponto', preenchido: e.classe === 'selo-vivo',
    texto: p.ultimoContatoEm ? `Sua ponte: último sinal ${haQuanto(p.ultimoContatoEm, agora)}. Só você vê estes dados.` : 'A chave foi criada, mas o robô ainda não mandou sinal.',
  };
}

function CartaoDaFonte({ c }: { c: Cartao }) {
  return (
    <section className="secao" aria-label={c.nome} style={{ gap: 6, padding: '18px 20px' }}>
      <h2 style={{ fontSize: 15, color: 'var(--apoio)' }}>{c.nome}</h2>
      <span className={`selo ${c.classe}`} style={{ fontSize: 17 }}>
        <Icone nome={c.icone} tamanho={18} preenchido={c.preenchido ?? false} />{c.estado}
      </span>
      <span className="linha-lista-apoio">{c.texto}</span>
    </section>
  );
}

export default function PaginaDiagnostico() {
  const { sessao } = useSessao();
  const superadmin = sessao.usuario.papel === 'superadmin';
  // Só o superadministrador consulta (a api recusa os demais).
  const diag = useConsultaPeriodica<Diagnostico>(superadmin ? '/api/diagnostico' : '/api/saude', 30_000);
  const situacao = useConsultaPeriodica<SituacaoDoMercado>('/api/mercado/situacao', 30_000);
  const pontes = useConsultaPeriodica<{ pontes: Ponte[] }>('/api/ponte', 30_000);
  const agora = new Date();

  if (!superadmin) {
    return (
      <>
        <Cabecalho titulo="Diagnóstico" />
        <p className="secao-vazia">Esta área é só para o superadministrador.</p>
      </>
    );
  }

  const d = diag.dados as Diagnostico | null;
  const cartoes = d
    ? [cartaoDaColeta(d, agora), cartaoDoFechamento(d), cartaoDaSelic(situacao.dados), cartaoDoMt5(pontes.dados?.pontes, agora), cartaoDaBrapi(d)]
    : [];

  return (
    <>
      <Cabecalho titulo="Diagnóstico" apoio="De onde vêm os dados e se estão em dia. Atualiza sozinho a cada 30 segundos." />
      <MensagemDeErro texto={diag.erro} />
      {!d && !diag.erro && <p className="secao-vazia" role="status">Carregando…</p>}
      {d && (
        <>
          <div className="grade-cartoes">
            {cartoes.map((c) => <CartaoDaFonte key={c.nome} c={c} />)}
          </div>

          <section className="secao" aria-labelledby="banco-titulo" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '12px 48px', alignItems: 'baseline', padding: '18px 24px' }}>
            <h2 id="banco-titulo">No banco</h2>
            <span><strong style={{ fontSize: 20 }}>{numero(d.banco.fechamentosUltimos30Dias)}</strong> <span className="linha-lista-apoio">fechamentos nos últimos 30 dias</span></span>
            <span><strong style={{ fontSize: 20 }}>{numero(d.banco.seriesVigentes)}</strong> <span className="linha-lista-apoio">séries de opções vigentes</span></span>
          </section>

          <section className="secao secao-tabela" aria-labelledby="tent-titulo">
            <div className="secao-topo"><h2 id="tent-titulo">Últimas tentativas de coleta</h2></div>
            {d.importacoes.length === 0 ? (
              <p className="secao-vazia" style={{ padding: '0 24px 12px' }}>Nenhuma tentativa ainda. A coleta começa quando o serviço "worker" estiver rodando no servidor.</p>
            ) : (
              <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Tabela de tentativas de coleta">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th scope="col">Quando</th>
                      <th scope="col">Fonte</th>
                      <th scope="col">Pregão</th>
                      <th scope="col">Resultado</th>
                      <th scope="col">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.importacoes.map((i) => {
                      const l = linhaDaTentativa(i);
                      return (
                        <tr key={i.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>{l.quando}</td>
                          <td>{l.fonte}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{l.pregao}</td>
                          <td style={{ whiteSpace: 'nowrap' }}><span className={`selo ${l.classe}`}>{l.resultado}</span></td>
                          <td className="linha-lista-apoio">{l.detalhe}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
