'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Cabecalho } from '../../componentes/Casca.tsx';
import { Icone } from '../../componentes/Icone.tsx';
import { ReguaDoPregao } from '../../componentes/Regua.tsx';
import { chamar, type Favorito } from '../../lib/api.ts';
import { diasAte, formatarData, formatarDataLonga } from '../../lib/formatos.ts';
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
        <ReguaDoPregao />
        <div className="fontes">
          <div className="fonte">
            <span style={{ color: 'var(--apoio)', display: 'inline-flex', paddingTop: 2 }}><Icone nome="relogio" /></span>
            <span>
              <span className="fonte-titulo">Ações: sem cotações ainda</span>
              <span className="fonte-texto">A coleta pela brapi (atualização a cada 30 minutos) começa na próxima etapa.</span>
            </span>
          </div>
          <div className="fonte">
            <span style={{ color: 'var(--apoio)', display: 'inline-flex', paddingTop: 2 }}><Icone nome="calendario" /></span>
            <span>
              <span className="fonte-titulo">Opções: sem arquivo da B3 ainda</span>
              <span className="fonte-texto">O fechamento diário das opções entra junto com a coleta. Feriados também.</span>
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
          {favoritos && favoritos.length > 0 && (
            <div className="tabela-caixa">
              <table className="tabela">
                <thead>
                  <tr>
                    <th scope="col">Ativo</th>
                    <th scope="col" className="numero">Último</th>
                    <th scope="col" className="numero">Dia</th>
                    <th scope="col">Dado</th>
                  </tr>
                </thead>
                <tbody>
                  {favoritos.map((f) => (
                    <tr key={f.codigo}>
                      <th scope="row">{f.codigo}</th>
                      <td className="numero" aria-label="sem cotação">—</td>
                      <td className="numero" aria-label="sem variação">—</td>
                      <td>
                        <span className="selo selo-neutro"><Icone nome="indisponivel" tamanho={16} />Sem cotação ainda</span>
                      </td>
                    </tr>
                  ))}
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
    </>
  );
}
