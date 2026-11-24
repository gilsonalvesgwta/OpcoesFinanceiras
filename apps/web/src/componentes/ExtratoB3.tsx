'use client';

// Importar o extrato de negociação da B3 (Excel da Área do Investidor): prévia com o que é
// novo, o que já está no sistema e o que falta; depois grava os novos de uma vez.

import { useRef, useState } from 'react';
import { chamar } from '../lib/api.ts';
import { formatarData, formatarReais } from '../lib/formatos.ts';
import { arquivoParaBase64, textoDoErroDasNotas } from '../lib/carteira.ts';
import { Icone } from './Icone.tsx';

type Negocio = {
  linha: number; data: string; lado: 'compra' | 'venda'; mercado: string; codigo: string; tipo: 'ativo' | 'call' | 'put';
  strike: number | null; vencimento: string | null; ativoObjeto: string | null; acao: string | null;
  quantidade: number; preco: number; valor: number; instituicao: string; falta: string[]; ja: boolean;
};
type Previa = { de: string | null; ate: string | null; negocios: Negocio[]; ignorados: { linha: number; codigo: string; motivo: string }[]; anosPendentes: number[] };

const NOME_DO_MERCADO: Record<string, string> = {
  vista: 'à vista', fracionario: 'fracionário', opcao_compra: 'call', opcao_venda: 'put', exercicio_compra: 'exercício de call', exercicio_venda: 'exercício de put',
};
const reais = (c: number | null) => (c === null ? '—' : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function ExtratoB3({ aoImportar }: { aoImportar: () => Promise<void> }) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);

  async function ler(lista: FileList | null) {
    const f = lista?.[0];
    if (!f) return;
    setErro(null); setAviso(null); setOcupado(true);
    try {
      setPrevia(await chamar<Previa>('POST', '/api/extrato-b3/ler', { arquivo: { nome: f.name, conteudo: await arquivoParaBase64(f) } }));
    } catch (x) {
      setErro(textoDoErroDasNotas(x, 'Não foi possível ler o extrato.'));
    } finally {
      setOcupado(false);
      if (arquivo.current) arquivo.current.value = '';
    }
  }

  const novos = (previa?.negocios ?? []).filter((n) => !n.ja && n.falta.length === 0);
  const faltando = (previa?.negocios ?? []).filter((n) => !n.ja && n.falta.length > 0);
  const ja = (previa?.negocios ?? []).filter((n) => n.ja).length;

  async function importar() {
    if (!novos.length) return;
    setOcupado(true); setErro(null);
    try {
      const r = await chamar<{ inseridos: number; jaExistiam: number; exercicios: number; viraramPo: number }>('POST', '/api/extrato-b3/importar', { negocios: novos });
      setPrevia(null);
      setAviso(`${r.inseridos} negócio(s) importado(s)${r.jaExistiam ? `, ${r.jaExistiam} já estavam no sistema` : ''}${r.exercicios ? `, ${r.exercicios} exercício(s)` : ''}${r.viraramPo ? `, ${r.viraramPo} opção(ões) vencida(s) sem exercício encerrada(s) a zero` : ''}.`);
      await aoImportar();
    } catch (x) {
      setErro(textoDoErroDasNotas(x, 'Não foi possível importar agora.'));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="secao" aria-labelledby="extrato-titulo">
      <h2 id="extrato-titulo">Importar tudo da B3 (extrato de negociação)</h2>
      <p className="linha-lista-apoio" style={{ margin: 0 }}>
        Todos os seus negócios, de todas as corretoras, de uma vez. Na <strong>Área do Investidor da B3</strong> (investidor.b3.com.br): <strong>Extratos → Negociação</strong>, escolha o período (desde o primeiro negócio) e <strong>exporte em Excel</strong>.
        {' '}O extrato não traz custos: importe também as notas de corretagem, que completam os custos dos mesmos negócios sem duplicar.
      </p>
      <div>
        <input ref={arquivo} id="extrato-b3" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="so-leitor" onChange={(e) => void ler(e.target.files)} />
        <label htmlFor="extrato-b3" className="botao botao-principal" style={{ display: 'inline-flex' }} aria-disabled={ocupado}>{ocupado && !previa ? 'Lendo…' : 'Escolher o extrato (Excel)'}</label>
      </div>
      {aviso && <p className="sucesso-titulo" role="status" style={{ margin: 0 }}>{aviso}</p>}
      {previa && (
        <div className="coluna" style={{ gap: 12 }}>
          <p style={{ margin: 0 }}>
            <strong>{previa.negocios.length.toLocaleString('pt-BR')} negócios</strong>{previa.de && previa.ate ? ` de ${formatarData(previa.de)} a ${formatarData(previa.ate)}` : ''}:
            {' '}<span className="selo selo-alta">{novos.length.toLocaleString('pt-BR')} novos</span>
            {' '}· <span className="selo selo-neutro">{ja.toLocaleString('pt-BR')} já no sistema</span>
            {faltando.length > 0 && <> · <span className="selo selo-atencao">{faltando.length.toLocaleString('pt-BR')} sem strike</span></>}
            {previa.ignorados.length > 0 && <> · <span className="selo selo-neutro">{previa.ignorados.length.toLocaleString('pt-BR')} fora do sistema (futuros)</span></>}
          </p>
          {previa.anosPendentes.length > 0 && (
            <div className="alerta" role="note"><Icone nome="aviso" /><span>
              O sistema está carregando o cadastro histórico de séries de opções da B3 de {previa.anosPendentes.join(', ')} (uma vez só; leva alguns minutos por ano).
              {' '}Os {faltando.length} negócios sem strike ficam de fora agora: importe os novos e, mais tarde, leia o mesmo extrato de novo para completar (o que já entrou não duplica).
            </span></div>
          )}
          {faltando.length > 0 && previa.anosPendentes.length === 0 && (
            <p className="linha-lista-apoio" style={{ margin: 0, fontSize: 13 }}>Sem strike no cadastro da B3: {faltando.slice(0, 12).map((n) => n.codigo).join(', ')}{faltando.length > 12 ? '…' : ''}. Esses ficam de fora; lance-os em "Lançar posição atual" se precisar.</p>
          )}
          {novos.length > 0 && (
            <div className="tabela-caixa" style={{ maxHeight: 420, overflowY: 'auto' }} tabIndex={0} role="region" aria-label="Negócios novos do extrato">
              <table className="tabela">
                <thead><tr><th scope="col">Data</th><th scope="col">Negócio</th><th scope="col">Código</th><th scope="col" className="numero">Qtd.</th><th scope="col" className="numero">Preço</th><th scope="col" className="numero">Valor</th><th scope="col">Corretora</th></tr></thead>
                <tbody>
                  {novos.map((n) => (
                    <tr key={n.linha}>
                      <td>{formatarData(n.data)}</td>
                      <td className={n.lado === 'venda' ? 'resultado-baixa' : 'resultado-alta'}>{n.lado === 'compra' ? 'Compra' : 'Venda'}<span className="sub">{NOME_DO_MERCADO[n.mercado] ?? n.mercado}</span></td>
                      <td><strong>{n.mercado.startsWith('exercicio') ? n.acao : n.codigo}</strong>
                        <span className="sub">{n.tipo === 'ativo' ? '' : `${n.mercado.startsWith('exercicio') ? `${n.codigo} · ` : ''}strike ${reais(n.strike)} · ${n.vencimento ? formatarData(n.vencimento) : ''}`}</span></td>
                      <td className="numero">{n.quantidade.toLocaleString('pt-BR')}</td>
                      <td className="numero">{reais(n.preco)}</td>
                      <td className="numero">{formatarReais(n.valor)}</td>
                      <td><span className="sub" style={{ marginTop: 0 }}>{n.instituicao.slice(0, 28)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="botao botao-principal" disabled={!novos.length || ocupado} onClick={() => void importar()}>{ocupado ? 'Importando…' : `Importar ${novos.length.toLocaleString('pt-BR')} negócio(s)`}</button>
            <button type="button" className="botao" disabled={ocupado} onClick={() => setPrevia(null)}>Cancelar</button>
            <span className="linha-lista-apoio" style={{ fontSize: 13 }}>Exercícios entram como a ação ao preço de exercício; opções vencidas sem exercício são encerradas a zero no vencimento.</span>
          </div>
        </div>
      )}
      {erro && <div className="alerta"><Icone nome="aviso" tamanho={18} /><span>{erro}</span></div>}
    </section>
  );
}
