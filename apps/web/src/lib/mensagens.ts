// Códigos de erro da api → frases para a pessoa. Cada frase diz o que houve e o
// que fazer, sem pedir desculpas e sem termos técnicos.

const MENSAGENS: Record<string, string> = {
  credenciais_invalidas: 'E-mail ou senha incorretos. Depois de 8 tentativas o acesso fica bloqueado por 15 minutos.',
  muitas_tentativas: 'Muitas tentativas seguidas. Espere 15 minutos e tente de novo.',
  nao_autenticado: 'Sua sessão terminou. Entre de novo para continuar.',
  sem_permissao: 'Sua conta não tem permissão para isso.',
  csrf_invalido: 'A página ficou desatualizada. Recarregue e tente de novo.',
  troca_de_senha_obrigatoria: 'Crie uma senha nova antes de continuar.',
  senha_curta: 'A senha precisa ter pelo menos 12 caracteres.',
  senha_longa: 'A senha pode ter no máximo 200 caracteres.',
  senha_invalida: 'Escolha uma senha com letras, números ou símbolos.',
  senha_igual_a_atual: 'A senha nova precisa ser diferente da atual.',
  senha_atual_incorreta: 'A senha atual não confere.',
  token_invalido: 'Este link não vale mais. Peça um novo em "Esqueci a senha".',
  convite_invalido: 'Este convite não vale mais. Peça um convite novo a quem convidou você.',
  email_ja_cadastrado: 'Já existe uma conta com este e-mail.',
  email_invalido: 'Confira o e-mail digitado.',
  convite_repetido: 'Já existe um convite para este e-mail.',
  nome_obrigatorio: 'Escreva seu nome.',
  nao_altera_o_proprio_acesso: 'Você não pode mudar o próprio papel nem suspender a própria conta.',
  ja_favorito: 'Este ativo já está na sua lista.',
  nao_encontrado: 'Não encontrado. Pode ter sido removido.',
  entrada_invalida: 'Confira os campos preenchidos.',
  erro_interno: 'O sistema não conseguiu concluir agora. Tente de novo em instantes.',
  sem_conexao: 'Sem conexão com o servidor. Confira a internet e tente de novo.',
};

export function mensagemDoErro(codigo: string): string {
  return MENSAGENS[codigo] ?? MENSAGENS.erro_interno ?? 'Erro.';
}
