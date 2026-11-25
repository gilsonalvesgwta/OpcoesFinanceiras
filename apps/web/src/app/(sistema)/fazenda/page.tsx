'use client';

// Vaca (Fazenda): o rebanho (cada vaca = venda de call e put rolada para ordenhar prêmio),
// com as contas da planilha (ordenha, rentabilidade a.m., ordenha média mensal, risco PUT),
// as pernas em aberto e todas as operações. Atualiza sozinha com as notas e o extrato da B3.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Cabecalho } from '../../../componentes/Casca.tsx';
import { MensagemDeErro } from '../../../componentes/Acesso.tsx';
import { Icone } from '../../../componentes/Icone.tsx';
import { chamar } from '../../../lib/api.ts';
import { formatarData, formatarReais } from '../../../lib/formatos.ts';
import { arquivoParaBase64, pctBr, textoDoErroDasNotas } from '../../../lib/carteira.ts';
import { lerReais } from '../../../lib/simulador.ts';
import { GLOSSARIO, totaisDaFazenda, type Fazenda, type Vaca } from '../../../lib/fazenda.ts';

const classe = (v: number | null) => (v === null || v === 0 ? '' : v > 0 ? 'resultado-alta' : 'resultado-baixa');
const reais = (c: number | null) => (c === null ? '—' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pctMes = (f: number | null) => (f === null ? '—' : `${(f * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% a.m.`);

function Faisca({ serie, rotulo }: { serie: { data: string; saldo: number }[]; rotulo: string }) {
  if (serie.length < 2) return null;
  const w = 220; const h = 44;
  const vals = serie.map((p) => p.saldo);
  const min = Math.min(0, ...vals); const max = Math.max(0, ...vals);
  const x = (i: number) => (i / (serie.length - 1)) * w;
  const y = (v: number) => h - 4 - ((v - min) / (max - min || 1)) * (h - 8);
  const d = serie.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.saldo).toFixed(1)}`).join(' ');
  const ultimo = vals[vals.length - 1] as number;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={rotulo} preserveAspectRatio="none" className="vaca-faisca">
      <line x1={0} x2={w} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--linha)', strokeDasharray: '3 3' }} />
      <path d={d} style={{ fill: 'none', stroke: ultimo >= 0 ? 'var(--alta)' : 'var(--baixa)', strokeWidth: 2 }} />
    </svg>
  );
}

function CartaoDaVaca({ v, ativa, escolher }: { v: Vaca; ativa: boolean; escolher: () => void }) {
  const r = v.resumo;
  return (
    <li>
      <button type="button" className={`vaca-cartao${ativa ? ' escolhida' : ''}${v.situacao === 'encerrada' ? ' encerrada' : ''}`} aria-pressed={ativa} onClick={escolher}>
        <span className="vaca-topo">
          <strong className="vaca-nome">{v.nome}</strong>
          <span className="vaca-oa" title="Calls / puts em aberto">{r.callsAbertas}/{r.putsAbertas}</span>
        </span>
        <span className="lotes-rotulo">{v.ativoObjeto} · desde {formatarData(v.dataInicio)} · {r.dias} dias{v.situacao === 'encerrada' ? ' · encerrada' : ''}</span>
        <span className="vaca-ordenha"><span className="lotes-rotulo">Ordenha</span><strong className={classe(r.ordenhaBruta)}>{formatarReais(r.ordenhaBruta)}</strong></span>
        <Faisca serie={r.serie} rotulo={`Saldo acumulado de ${v.nome}`} />
        <span className="vaca-metricas">
          <span><span className="lotes-rotulo">Rentab.</span>{pctMes(r.rentabilidadeMensal)}</span>
          <span><span className="lotes-rotulo">Média/mês</span>{formatarReais(r.ordenhaMediaMensal)}</span>
          <span><span className="lotes-rotulo">Margem</span>{formatarReais(v.margem)}</span>
        </span>
      </button>
    </li>
  );
}

type FormOp = { data: string; lado: 'venda' | 'compra'; tipo: 'call' | 'put'; quantidade: string; ticker: string; strike: string; vencimento: string; preco: string };

function DetalheDaVaca({ v, agir, hoje }: { v: Vaca; agir: (fn: () => Promise<unknown>, ok: string) => Promise<boolean>; hoje: string }) {
  const r = v.resumo;
  const [recentes, setRecentes] = useState(true);
  const [editando, setEditando] = useState(false);
  const [cfg, setCfg] = useState({ nome: v.nome, dataInicio: v.dataInicio, margem: reais(v.margem), quantidade: v.quantidade ? String(v.quantidade) : '', distancia: String(Math.round(v.distancia * 100)) });
  const [op, setOp] = useState<FormOp>({ data: hoje, lado: 'venda', tipo: 'call', quantidade: v.quantidade ? String(v.quantidade) : '', ticker: '', strike: '', vencimento: '', preco: '' });
  const [erroOp, setErroOp] = useState<string | null>(null);
  const linhas = recentes ? [...v.linhas].reverse() : v.linhas;

  async function salvarCfg(e: FormEvent) {
    e.preventDefault();
    const margem = lerReais(cfg.margem);
    const dist = Number(cfg.distancia.replace(',', '.'));
    const ok = await agir(() => chamar('PATCH', `/api/fazenda/vacas/${v.id}`, {
      nome: cfg.nome, dataInicio: cfg.dataInicio, margem: margem ?? 0, quantidade: cfg.quantidade ? Number(cfg.quantidade) : null,
      ...(dist > 0 && dist < 100 ? { distancia: dist / 100 } : {}),
    }), 'Vaca atualizada.');
    if (ok) setEditando(false);
  }
  async function lancar(e: FormEvent) {
    e.preventDefault();
    const quantidade = Number(op.quantidade);
    const preco = lerReais(op.preco);
    if (!op.ticker.trim() || !Number.isInteger(quantidade) || quantidade <= 0 || preco === null) return setErroOp('Preencha ticker, quantidade e preço.');
    setErroOp(null);
    const ok = await agir(() => chamar('POST', `/api/fazenda/vacas/${v.id}/operacoes`, {
      data: op.data, lado: op.lado, tipo: op.tipo, quantidade, ticker: op.ticker.trim(), preco,
      strike: lerReais(op.strike), vencimento: op.vencimento || null,
    }), 'Operação lançada.');
    if (ok) setOp({ ...op, ticker: '', strike: '', preco: '' });
  }

  return (
    <section className="secao vaca-detalhe" aria-labelledby="vaca-titulo">
      <div className="vaca-faixa">
        <div>
          <span className="lotes-rotulo">Vaca</span>
          <h2 id="vaca-titulo">{v.nome}</h2>
          <span className="lotes-rotulo">{v.ativoObjeto} {v.cotacao?.ultimo ? `R$ ${reais(v.cotacao.ultimo)}` : ''} · perna de {v.quantidade ?? '—'} · alerta a {Math.round(v.distancia * 100)}% do preço</span>
        </div>
        <div className="vaca-faixa-acoes">
          <button type="button" className="botao botao-pequeno" onClick={() => setEditando((x) => !x)}>{editando ? 'Fechar ajustes' : 'Ajustar'}</button>
          <button type="button" className="botao botao-pequeno" onClick={() => void agir(() => chamar('PATCH', `/api/fazenda/vacas/${v.id}`, { situacao: v.situacao === 'ativa' ? 'encerrada' : 'ativa' }), v.situacao === 'ativa' ? 'Vaca encerrada.' : 'Vaca reaberta.')}>{v.situacao === 'ativa' ? 'Encerrar' : 'Reabrir'}</button>
        </div>
      </div>

      <dl className="vaca-kpis">
        <div><dt>Data da compra</dt><dd>{formatarData(v.dataInicio)}</dd></div>
        <div><dt>Rentabilidade</dt><dd>{pctMes(r.rentabilidadeMensal)}</dd></div>
        <div><dt>Ordenha bruta</dt><dd className={classe(r.ordenhaBruta)}>{formatarReais(r.ordenhaBruta)}</dd></div>
        <div><dt>Margem</dt><dd>{formatarReais(v.margem)}</dd></div>
        <div><dt>Ordenha média mensal</dt><dd>{formatarReais(r.ordenhaMediaMensal)}</dd></div>
        <div><dt>Risco PUT</dt><dd>{formatarReais(r.riscoPut)}</dd></div>
        <div><dt>Custos das notas</dt><dd>{formatarReais(r.custos)}</dd></div>
        <div><dt>Ordenha líquida</dt><dd className={classe(r.ordenhaLiquida)}>{formatarReais(r.ordenhaLiquida)}</dd></div>
      </dl>

      {editando && (
        <form className="boleta" onSubmit={(e) => void salvarCfg(e)} noValidate>
          <div className="campo" style={{ flex: '0 1 160px' }}><label htmlFor="vc-nome">Nome</label><input id="vc-nome" value={cfg.nome} maxLength={40} onChange={(e) => setCfg({ ...cfg, nome: e.target.value.toUpperCase() })} /></div>
          <div className="campo" style={{ flex: '0 1 160px' }}><label htmlFor="vc-data">Data da compra</label><input id="vc-data" type="date" value={cfg.dataInicio} onChange={(e) => setCfg({ ...cfg, dataInicio: e.target.value })} /></div>
          <div className="campo" style={{ flex: '0 1 140px' }}><label htmlFor="vc-margem">Margem (R$)</label><input id="vc-margem" inputMode="decimal" value={cfg.margem} onChange={(e) => setCfg({ ...cfg, margem: e.target.value })} /></div>
          <div className="campo" style={{ flex: '0 1 130px' }}><label htmlFor="vc-qtd">Tamanho da perna</label><input id="vc-qtd" inputMode="numeric" value={cfg.quantidade} onChange={(e) => setCfg({ ...cfg, quantidade: e.target.value })} /></div>
          <div className="campo" style={{ flex: '0 1 130px' }}><label htmlFor="vc-dist">Alerta de strike (%)</label><input id="vc-dist" inputMode="numeric" value={cfg.distancia} onChange={(e) => setCfg({ ...cfg, distancia: e.target.value })} /></div>
          <button type="submit" className="botao botao-principal">Salvar</button>
          <button type="button" className="botao-texto botao-perigo" onClick={() => { if (window.confirm(`Apagar a vaca ${v.nome} e todas as operações dela aqui? As execuções das notas continuam em Posições.`)) void agir(() => chamar('DELETE', `/api/fazenda/vacas/${v.id}`), 'Vaca apagada.'); }}>Apagar vaca</button>
          <p className="linha-lista-apoio" style={{ margin: 0, flexBasis: '100%', fontSize: 13 }}>Tamanho da perna: operações das notas de {v.ativoObjeto} com essa quantidade entram sozinhas nesta vaca.</p>
        </form>
      )}

      <div>
        <h3 className="vaca-sub">Pernas em aberto</h3>
        {r.pernas.length === 0 ? <p className="secao-vazia" style={{ margin: 0 }}>Nenhuma perna aberta agora.</p> : (
          <ul className="vaca-pernas">
            {r.pernas.map((p) => (
              <li key={p.chave} className={p.atencao ? 'atencao' : ''}>
                <span className={`vaca-tipo ${p.tipo}`}>{p.tipo === 'call' ? 'CALL' : 'PUT'}</span>
                <strong>{p.ticker}</strong>
                <span>{p.quantidade < 0 ? 'vendida' : 'comprada'} · {Math.abs(p.quantidade).toLocaleString('pt-BR')}</span>
                <span>strike R$ {reais(p.strike)}{p.distancia !== null ? <small> ({pctBr(p.distancia)})</small> : null}</span>
                <span>{p.vencimento ? `vence ${formatarData(p.vencimento)}${p.dias !== null ? ` · ${p.dias} d` : ''}` : 'sem vencimento'}</span>
                {p.atencao && <span className="vaca-alerta"><Icone nome="aviso" tamanho={16} /> {p.atencao}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="vaca-ops-topo">
        <h3 className="vaca-sub">Operações ({v.linhas.length})</h3>
        <button type="button" className="botao-texto" onClick={() => setRecentes((x) => !x)}>{recentes ? 'Mais recentes primeiro' : 'Em ordem de data'} ⇅</button>
      </div>
      <div className="tabela-caixa vaca-tabela" tabIndex={0} role="region" aria-label={`Operações de ${v.nome}`}>
        <table className="tabela">
          <thead>
            <tr>
              <th scope="col">Data</th><th scope="col">Operação</th><th scope="col">Tipo</th><th scope="col" className="numero">Qtd.</th><th scope="col">Ticker</th>
              <th scope="col" className="numero">Strike</th><th scope="col">Em custódia</th><th scope="col">Vencimento</th><th scope="col" className="numero">Preço</th>
              <th scope="col" className="numero">Total</th><th scope="col" className="numero">Saldo</th><th scope="col">Atenção</th><th scope="col"><span className="so-leitor">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id}>
                <td>{formatarData(l.data)}</td>
                <td><span className={`vaca-lado ${l.lado}`}>{l.lado === 'venda' ? 'VENDA' : 'COMPRA'}</span></td>
                <td>{l.tipo.toUpperCase()}</td>
                <td className="numero">{l.quantidade.toLocaleString('pt-BR')}</td>
                <td><strong>{l.ticker.toUpperCase()}</strong><span className="sub" style={{ marginTop: 0 }}>{l.origem === 'nota' ? 'da nota' : l.origem === 'planilha' ? 'da planilha' : 'manual'}{l.execucaoId && l.origem === 'planilha' ? ' · conferida com nota' : ''}</span></td>
                <td className="numero">{reais(l.strike)}</td>
                <td><span className={`vaca-custodia ${l.emCustodia ? 'sim' : ''}`}>{l.emCustodia ? 'SIM' : 'NÃO'}</span></td>
                <td>{l.vencimento ? formatarData(l.vencimento) : '—'}</td>
                <td className="numero">R$ {(l.preco / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
                <td className={`numero vaca-total ${l.total >= 0 ? 'mais' : 'menos'}`}>{formatarReais(l.total)}</td>
                <td className={`numero ${classe(l.saldo)}`}>{formatarReais(l.saldo)}</td>
                <td>{l.atencao ? <span className="vaca-alerta">{l.atencao}</span> : ''}</td>
                <td>{!l.execucaoId && <button type="button" className="botao-texto botao-perigo" aria-label={`Apagar a operação de ${formatarData(l.data)} ${l.ticker}`} onClick={() => void agir(() => chamar('DELETE', `/api/fazenda/operacoes/${l.id}`), 'Operação apagada.')}><Icone nome="lixeira" tamanho={16} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="dobra">
        <summary><h3 className="vaca-sub" style={{ display: 'inline' }}>Lançar operação à mão</h3> <span className="lotes-rotulo">o que não veio por nota</span></summary>
        <form className="boleta" style={{ marginTop: 12 }} onSubmit={(e) => void lancar(e)} noValidate>
          <div className="campo" style={{ flex: '0 1 150px' }}><label htmlFor="vo-data">Data</label><input id="vo-data" type="date" value={op.data} onChange={(e) => setOp({ ...op, data: e.target.value })} /></div>
          <div className="campo" style={{ flex: '0 1 110px' }}><label htmlFor="vo-lado">Operação</label><select id="vo-lado" value={op.lado} onChange={(e) => setOp({ ...op, lado: e.target.value as FormOp['lado'] })}><option value="venda">Venda</option><option value="compra">Compra</option></select></div>
          <div className="campo" style={{ flex: '0 1 100px' }}><label htmlFor="vo-tipo">Tipo</label><select id="vo-tipo" value={op.tipo} onChange={(e) => setOp({ ...op, tipo: e.target.value as FormOp['tipo'] })}><option value="call">Call</option><option value="put">Put</option></select></div>
          <div className="campo" style={{ flex: '0 1 100px' }}><label htmlFor="vo-qtd">Quantidade</label><input id="vo-qtd" inputMode="numeric" value={op.quantidade} onChange={(e) => setOp({ ...op, quantidade: e.target.value })} /></div>
          <div className="campo" style={{ flex: '0 1 140px' }}><label htmlFor="vo-ticker">Ticker</label><input id="vo-ticker" value={op.ticker} maxLength={16} onChange={(e) => setOp({ ...op, ticker: e.target.value.toUpperCase() })} placeholder="BOVAL160W4" /></div>
          <div className="campo" style={{ flex: '0 1 100px' }}><label htmlFor="vo-strike">Strike</label><input id="vo-strike" inputMode="decimal" value={op.strike} onChange={(e) => setOp({ ...op, strike: e.target.value })} /></div>
          <div className="campo" style={{ flex: '0 1 150px' }}><label htmlFor="vo-venc">Vencimento</label><input id="vo-venc" type="date" value={op.vencimento} onChange={(e) => setOp({ ...op, vencimento: e.target.value })} /></div>
          <div className="campo" style={{ flex: '0 1 100px' }}><label htmlFor="vo-preco">Preço</label><input id="vo-preco" inputMode="decimal" value={op.preco} onChange={(e) => setOp({ ...op, preco: e.target.value })} /></div>
          <button type="submit" className="botao botao-principal">Lançar</button>
        </form>
        <MensagemDeErro texto={erroOp} />
      </details>
    </section>
  );
}

export default function PaginaFazenda() {
  const [dados, setDados] = useState<Fazenda | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [nova, setNova] = useState<{ nome: string; dataInicio: string; margem: string; quantidade: string } | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);
  const carregando = useRef(false);

  const carregar = useCallback(async () => {
    if (carregando.current) return;
    carregando.current = true;
    try {
      const d = await chamar<Fazenda>('GET', '/api/fazenda');
      setDados(d);
      setErro(null);
      setEscolhida((e) => (e && d.vacas.some((v) => v.id === e) ? e : d.vacas.find((v) => v.situacao === 'ativa')?.id ?? d.vacas[0]?.id ?? null));
      if (d.distribuidasAgora) setAviso(`${d.distribuidasAgora} operação(ões) das notas entraram sozinhas nas vacas.`);
    } catch (x) {
      setErro(x instanceof Error ? x.message : 'Não foi possível carregar a fazenda.');
    } finally {
      carregando.current = false;
    }
  }, []);
  useEffect(() => {
    void carregar();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void carregar(); }, 15_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function agir(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    setErro(null);
    try { await fn(); setAviso(ok); await carregar(); return true; } catch (x) { setErro(textoDoErroDasNotas(x, 'Não foi possível concluir.')); return false; }
  }
  async function importar(lista: FileList | null) {
    const f = lista?.[0];
    if (!f) return;
    setOcupado(true);
    await agir(async () => {
      const r = await chamar<{ vacas: { nome: string; operacoes: number; nova: boolean }[] }>('POST', '/api/fazenda/importar', { arquivo: { nome: f.name, conteudo: await arquivoParaBase64(f) } });
      setAviso(null);
      return r;
    }, 'Planilha importada: as vacas e as operações estão abaixo.');
    setOcupado(false);
    if (arquivo.current) arquivo.current.value = '';
  }
  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!nova) return;
    const ok = await agir(() => chamar('POST', '/api/fazenda/vacas', { nome: nova.nome, dataInicio: nova.dataInicio, margem: lerReais(nova.margem) ?? 0, quantidade: nova.quantidade ? Number(nova.quantidade) : null }), `Vaca ${nova.nome} criada.`);
    if (ok) setNova(null);
  }

  const t = useMemo(() => (dados ? totaisDaFazenda(dados.vacas) : null), [dados]);
  const vaca = dados?.vacas.find((v) => v.id === escolhida) ?? null;
  const ativas = dados?.vacas.filter((v) => v.situacao === 'ativa') ?? [];

  return (
    <>
      <Cabecalho
        titulo="Vaca (Fazenda)"
        apoio="Venda de call e put com rolagens semanais e mensais: a ordenha de cada vaca, atualizada sozinha com as notas e o extrato da B3. Só acompanhamento: nada aqui envia ordem."
        acoes={!nova ? <button type="button" className="botao botao-principal" onClick={() => setNova({ nome: '', dataInicio: dados?.hoje ?? '', margem: '', quantidade: '' })}><Icone nome="mais" tamanho={18} />Nova vaca</button> : undefined}
      />
      <MensagemDeErro texto={erro} />
      {aviso && <p className="sucesso-titulo" role="status" style={{ margin: 0 }}>{aviso}</p>}

      {nova && (
        <section className="secao" aria-labelledby="nova-vaca">
          <h2 id="nova-vaca">Nova vaca</h2>
          <form className="boleta" onSubmit={(e) => void criar(e)} noValidate>
            <div className="campo" style={{ flex: '0 1 180px' }}><label htmlFor="nv-nome">Nome</label><input id="nv-nome" value={nova.nome} maxLength={40} placeholder="PIONEIRA" onChange={(e) => setNova({ ...nova, nome: e.target.value.toUpperCase() })} /></div>
            <div className="campo" style={{ flex: '0 1 160px' }}><label htmlFor="nv-data">Data da compra</label><input id="nv-data" type="date" value={nova.dataInicio} onChange={(e) => setNova({ ...nova, dataInicio: e.target.value })} /></div>
            <div className="campo" style={{ flex: '0 1 140px' }}><label htmlFor="nv-margem">Margem (R$)</label><input id="nv-margem" inputMode="decimal" value={nova.margem} onChange={(e) => setNova({ ...nova, margem: e.target.value })} /></div>
            <div className="campo" style={{ flex: '0 1 140px' }}><label htmlFor="nv-qtd">Tamanho da perna</label><input id="nv-qtd" inputMode="numeric" value={nova.quantidade} placeholder="120" onChange={(e) => setNova({ ...nova, quantidade: e.target.value })} /></div>
            <button type="submit" className="botao botao-principal" disabled={!nova.nome.trim() || !nova.dataInicio}>Criar</button>
            <button type="button" className="botao" onClick={() => setNova(null)}>Cancelar</button>
          </form>
        </section>
      )}

      {dados === null && !erro && <section className="secao"><p className="secao-vazia" role="status">Carregando a fazenda…</p></section>}

      {dados && dados.vacas.length === 0 && (
        <section className="secao fazenda-vazia">
          <h2>Comece o rebanho</h2>
          <p className="linha-lista-apoio" style={{ margin: 0 }}>Importe a sua planilha da fazenda (Excel ou Google Sheets baixado em .xlsx): cada aba de vaca vira uma vaca, com a data da compra, a margem e todas as operações. Ou crie uma vaca nova.</p>
        </section>
      )}

      {t && dados && dados.vacas.length > 0 && (
        <section className="fazenda-hero" aria-label="Resumo da fazenda">
          <div className="fazenda-hero-titulo"><span className="lotes-rotulo">Fazenda</span><strong>{t.vacas} vaca{t.vacas === 1 ? '' : 's'} produzindo</strong></div>
          <dl className="fazenda-numeros">
            <div className="destaque"><dt>Ordenha total</dt><dd className={classe(t.ordenha)}>{formatarReais(t.ordenha)}</dd><dd className="fazenda-nota">líquida estimada (−15% IR) {formatarReais(t.ordenhaLiquidaIr)}</dd></div>
            <div><dt>Ordenha média mensal</dt><dd>{formatarReais(t.mediaMensal)}</dd><dd className="fazenda-nota">soma das vacas</dd></div>
            <div><dt>Rentabilidade média</dt><dd>{pctMes(t.rentabilidade)}</dd><dd className="fazenda-nota">ponderada pela margem</dd></div>
            <div><dt>Margem</dt><dd>{formatarReais(t.margem)}</dd><dd className="fazenda-nota">garantia reservada</dd></div>
            <div><dt>Risco PUT</dt><dd>{formatarReais(t.riscoPut)}</dd><dd className="fazenda-nota">puts vendidas em aberto × preço</dd></div>
          </dl>
        </section>
      )}

      {dados && dados.vacas.length > 0 && (
        <section className="secao" aria-labelledby="rebanho">
          <h2 id="rebanho">O rebanho</h2>
          <ul className="vaca-grade">
            {[...ativas, ...dados.vacas.filter((v) => v.situacao !== 'ativa')].map((v) => <CartaoDaVaca key={v.id} v={v} ativa={v.id === escolhida} escolher={() => setEscolhida(v.id)} />)}
          </ul>
        </section>
      )}

      {vaca && dados && <DetalheDaVaca key={vaca.id} v={vaca} agir={agir} hoje={dados.hoje} />}

      {dados && dados.paraDistribuir.length > 0 && ativas.length > 0 && (
        <section className="secao secao-tabela" aria-labelledby="distribuir">
          <div className="secao-topo"><h2 id="distribuir">Para distribuir ({dados.paraDistribuir.length})</h2><span className="linha-lista-apoio">Operações de opção das notas que não deu para saber de qual vaca são (quantidade diferente da perna ou mais de uma vaca do mesmo tamanho).</span></div>
          <div className="tabela-caixa" tabIndex={0} role="region" aria-label="Operações para distribuir">
            <table className="tabela">
              <thead><tr><th scope="col">Data</th><th scope="col">Operação</th><th scope="col">Código</th><th scope="col" className="numero">Qtd.</th><th scope="col" className="numero">Preço</th><th scope="col">Vaca</th></tr></thead>
              <tbody>
                {dados.paraDistribuir.slice(0, 60).map((x) => {
                  const escolha = escolhas[x.id] ?? x.sugestao[0] ?? ativas[0]?.id ?? '';
                  return (
                    <tr key={x.id}>
                      <td>{formatarData(x.dia)}</td>
                      <td><span className={`vaca-lado ${x.lado}`}>{x.lado === 'venda' ? 'VENDA' : 'COMPRA'}</span> {x.tipo.toUpperCase()}</td>
                      <td><strong>{x.codigo}</strong><span className="sub" style={{ marginTop: 0 }}>strike {reais(x.strike)} · {x.vencimento ? formatarData(x.vencimento) : '—'}</span></td>
                      <td className="numero">{x.quantidade.toLocaleString('pt-BR')}</td>
                      <td className="numero">{reais(x.preco)}</td>
                      <td>
                        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <select aria-label={`Vaca para ${x.codigo} de ${formatarData(x.dia)}`} value={escolha} onChange={(e) => setEscolhas({ ...escolhas, [x.id]: e.target.value })}>
                            {ativas.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
                          </select>
                          <button type="button" className="botao botao-pequeno" disabled={!escolha} onClick={() => void agir(() => chamar('POST', '/api/fazenda/distribuir', { execucaoId: x.id, vacaId: escolha }), `${x.codigo} foi para a vaca.`)}>Pôr na vaca</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <details className="secao dobra" open={dados ? dados.vacas.length === 0 : false}>
        <summary><h2 style={{ display: 'inline' }}>Importar a planilha da fazenda</h2> <span className="lotes-rotulo">Excel ou Google Sheets baixado em .xlsx</span></summary>
        <div className="coluna" style={{ gap: 10, marginTop: 12 }}>
          <p className="linha-lista-apoio" style={{ margin: 0 }}>Cada aba de vaca (com &quot;Data da Operação&quot;, &quot;Operação&quot;, &quot;Tipo&quot;, &quot;Quantidade&quot;, &quot;Ticker&quot;, &quot;Preço&quot;...) vira uma vaca com a data da compra, a margem e as operações. Importar de novo não duplica.</p>
          <div>
            <input ref={arquivo} id="fazenda-planilha" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="so-leitor" onChange={(e) => void importar(e.target.files)} />
            <label htmlFor="fazenda-planilha" className="botao botao-principal" style={{ display: 'inline-flex' }} aria-disabled={ocupado}>{ocupado ? 'Importando…' : 'Escolher a planilha'}</label>
          </div>
        </div>
      </details>

      <details className="secao dobra">
        <summary><h2 style={{ display: 'inline' }}>Terminologia</h2> <span className="lotes-rotulo">o dicionário da fazenda</span></summary>
        <dl className="fazenda-glossario">
          {GLOSSARIO.map(([termo, def]) => <div key={termo}><dt>{termo}</dt><dd>{def}</dd></div>)}
        </dl>
        <p className="linha-lista-apoio" style={{ margin: 0, fontSize: 13 }}>
          Contas: ordenha = vendas − recompras; ordenha média mensal = ordenha ÷ (dias ÷ 30); rentabilidade a.m. = (1 + ordenha ÷ margem)^(30 ÷ dias) − 1;
          risco PUT = puts vendidas em aberto × preço do ativo; &quot;em custódia&quot; = perna ainda aberta (calculado).
        </p>
      </details>
    </>
  );
}
