// Copia o robô da ponte (fonte única: ponte-mt5/WTA_Ponte.mq5) para os arquivos
// públicos da interface, de onde ele é baixado em Preferências › MetaTrader 5.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const origem = join(aqui, '..', '..', '..', 'ponte-mt5', 'WTA_Ponte.mq5');
const destino = join(aqui, '..', 'public', 'ponte', 'WTA_Ponte.mq5');
mkdirSync(dirname(destino), { recursive: true });
copyFileSync(origem, destino);
console.log('robô copiado para public/ponte/WTA_Ponte.mq5');
