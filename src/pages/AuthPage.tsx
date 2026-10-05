import { xanoReady } from '../data/xano/config';
import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, LockKeyhole, WifiOff } from 'lucide-react';
import { auth } from '../data/auth';
import type { User } from '../domain/types';
import { Brand, Button, ErrorText, Field } from '../components/ui';
export function AuthPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    try {
      if (mode === 'reset') await auth.requestPasswordReset(String(form.get('email')));
      else if (mode === 'signup') { if (form.get('password') !== form.get('confirm')) throw new Error('As senhas não coincidem.'); onLogin(await auth.signUp({ name: String(form.get('name')), email: String(form.get('email')), username: String(form.get('username')), password: String(form.get('password')) })); }
      else onLogin(await auth.signIn(String(form.get('identifier')), String(form.get('password')), form.get('remember') === 'on'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível entrar.'); } finally { setBusy(false); }
  }
  async function demo() { setBusy(true); setError(''); try { const { openDemo } = await import('../data/demo'); onLogin(await openDemo()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <div className="auth-page"><section className="auth-story"><Brand /><div><span className="auth-symbol"><img src="/favicon.svg" alt="" /></span><h1>Mais clareza.<br />Mais tranquilidade.</h1><p>Seu dinheiro organizado.<br />Sua vida em perspectiva.</p><ul><li><Check size={18} /> Finanças pessoais e em família</li><li><Check size={18} /> Cartões, parcelas e recorrências</li><li><WifiOff size={18} /> Seus registros, mesmo sem internet</li></ul></div><small>BS Wallet · Feito para o seu dia a dia.</small></section><section className="auth-content"><div className="auth-form"><Brand /><h2>{mode === 'signup' ? 'Crie sua carteira' : mode === 'reset' ? 'Recupere seu acesso' : 'Bom ter você aqui.'}</h2><p>{mode === 'signup' ? 'Você será o Administrador Master da sua família.' : mode === 'reset' ? 'Consulte a disponibilidade de recuperação por e-mail.' : 'Entre para cuidar das suas finanças.'}</p><form onSubmit={submit}>
    {mode === 'signup' && <><Field label="Seu nome"><input name="name" autoComplete="name" required maxLength={100} /></Field><Field label="E-mail"><input name="email" type="email" autoComplete="email" required /></Field><Field label="Username"><input name="username" autoComplete="username" required pattern="[A-Za-z0-9._\-]{3,32}" /></Field></>}
    {mode === 'login' && <Field label="E-mail ou username"><input name="identifier" autoComplete="username" placeholder="Como você se cadastrou" required /></Field>}
    {mode === 'reset' ? <Field label="E-mail"><input name="email" type="email" autoComplete="email" required /></Field> : <Field label="Senha" hint={mode === 'signup' ? 'De 12 a 128 caracteres.' : undefined}><input name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 12 : undefined} maxLength={128} required /></Field>}
    {mode === 'signup' && <Field label="Confirmar senha"><input name="confirm" type="password" autoComplete="new-password" required /></Field>}
    {mode === 'login' && <div className="auth-options"><label className="check"><input type="checkbox" name="remember" defaultChecked /> Manter conectado</label><button type="button" className="text-button" onClick={() => { setMode('reset'); setError(''); }}>Esqueci a senha</button></div>}
    <ErrorText error={error} /><Button disabled={busy} type="submit">{busy ? 'Aguarde…' : mode === 'signup' ? 'Criar minha carteira' : mode === 'reset' ? 'Verificar recuperação' : 'Entrar na minha carteira'}<ArrowRight size={18} /></Button>
  </form><p className="auth-switch">{mode === 'login' ? 'Primeira vez por aqui? ' : 'Já tem uma conta? '}<button className="text-button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}>{mode === 'login' ? 'Criar conta' : 'Entrar'}</button></p>{import.meta.env.DEV && <Button variant="secondary" disabled={busy} onClick={demo}>Explorar demonstração local</Button>}<div className="local-note"><LockKeyhole size={18} /><span>{xanoReady() ? 'Sincronização com Xano disponível. Seus dados são salvos primeiro neste dispositivo e enviados em segundo plano quando sua conta estiver conectada.' : 'Modo local: sua conta e seus dados ficam neste navegador. A sincronização em nuvem está desativada nesta versão.'}</span></div></div></section></div>;
}
