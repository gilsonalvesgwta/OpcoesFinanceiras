import { EmBreve } from '../../../componentes/EmBreve.tsx';

export const metadata = { title: 'Diagnóstico' };

export default function Pagina() {
  return <EmBreve titulo="Diagnóstico" fase="Fase 3" texto="Aqui os administradores vão ver a saúde do sistema: fontes de dados, idade das cotações, cota da brapi, fila de avisos, banco e servidor." />;
}
