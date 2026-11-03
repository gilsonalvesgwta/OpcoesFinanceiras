// A Cadeia de opções virou parte do Simulador (cadeia ao vivo, C/V, boleta e montagem).
// O endereço antigo continua funcionando e leva para lá.

import { redirect } from 'next/navigation';

export default function PaginaCadeia() {
  redirect('/simulador');
}
