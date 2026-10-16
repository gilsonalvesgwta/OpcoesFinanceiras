import { EmBreve } from '../../../componentes/EmBreve.tsx';

export const metadata = { title: 'Alertas' };

export default function Pagina() {
  return <EmBreve titulo="Alertas" fase="Fase 4" texto="Aqui você vai montar regras de alerta sem programar (preço que cruza um nível, faixa, variação, condições combinadas) e receber os avisos no Telegram, sem repetição." />;
}
