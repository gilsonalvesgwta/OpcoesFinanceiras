import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conferirSenha, gerarHashDeSenha, hashDoToken, iguaisEmTempoConstante, normalizarEmail, novoToken, problemaDaSenha, tokenComFormatoValido,
} from './seguranca.ts';

test('senha: hash com sal, confere a certa e recusa a errada', async () => {
  const h1 = await gerarHashDeSenha('correto cavalo bateria');
  const h2 = await gerarHashDeSenha('correto cavalo bateria');
  assert.match(h1, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(h1, h2, 'sal diferente a cada hash');
  assert.equal(await conferirSenha('correto cavalo bateria', h1), true);
  assert.equal(await conferirSenha('correto cavalo bateriA', h1), false);
  assert.equal(await conferirSenha('qualquer', null), false);
  assert.equal(await conferirSenha('qualquer', 'texto-puro'), false);
});

test('regras da senha', () => {
  assert.equal(problemaDaSenha('curta'), 'senha_curta');
  assert.equal(problemaDaSenha('x'.repeat(201)), 'senha_longa');
  assert.equal(problemaDaSenha(' '.repeat(12)), 'senha_invalida');
  assert.equal(problemaDaSenha(123), 'senha_invalida');
  assert.equal(problemaDaSenha('doze letras!'), null);
});

test('tokens: 32 bytes aleatórios, só o hash é guardado', () => {
  const t = novoToken();
  assert.ok(tokenComFormatoValido(t));
  assert.notEqual(t, novoToken());
  assert.equal(hashDoToken(t).length, 32);
  assert.deepEqual(hashDoToken(t), hashDoToken(t));
  assert.equal(tokenComFormatoValido('curto'), false);
  assert.equal(tokenComFormatoValido(`${t}'`), false);
});

test('e-mail normalizado e CSRF comparado sem atalho', () => {
  assert.equal(normalizarEmail('  Alves.Gilson@Yahoo.com.BR '), 'alves.gilson@yahoo.com.br');
  assert.equal(normalizarEmail('sem-arroba'), null);
  assert.equal(normalizarEmail(42), null);
  assert.equal(iguaisEmTempoConstante('abc', 'abc'), true);
  assert.equal(iguaisEmTempoConstante('abc', 'abd'), false);
});
