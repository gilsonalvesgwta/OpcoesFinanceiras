// Envio de e-mail (convites e recuperação de senha).
// O envio por SMTP entra numa etapa seguinte; até lá, sem SMTP configurado, o
// sistema registra que não enviou (sem o link, que é secreto) e o administrador
// usa o link que a tela mostra na hora do convite.

export type Mensagem = { para: string; assunto: string; texto: string };

export interface Correio {
  readonly configurado: boolean;
  enviar(m: Mensagem): Promise<void>;
}

export class CorreioDesligado implements Correio {
  readonly configurado = false;
  private readonly avisar: (msg: string) => void;
  constructor(avisar: (msg: string) => void) {
    this.avisar = avisar;
  }
  async enviar(m: Mensagem): Promise<void> {
    this.avisar(`e-mail não enviado (SMTP não configurado): "${m.assunto}"`);
  }
}

// Para os testes: guarda as mensagens em vez de enviar.
export class CorreioDeTeste implements Correio {
  readonly configurado = true;
  readonly enviados: Mensagem[] = [];
  async enviar(m: Mensagem): Promise<void> {
    this.enviados.push(m);
  }
  ultimoPara(email: string): Mensagem | undefined {
    return [...this.enviados].reverse().find((m) => m.para === email);
  }
}
