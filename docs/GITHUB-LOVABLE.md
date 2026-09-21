# BS Wallet — GitHub privado e Lovable

Documentação oficial consultada em 17/09/2026. Nenhum repositório, projeto Lovable ou site foi criado remotamente durante a geração destes arquivos.

## Decisão antes de começar

**Lovable não importa um repositório GitHub existente.** Ao conectar um projeto, ele cria outro repositório, privado por padrão. Sincroniza a branch ativa em ambos os sentidos; o seletor permite trocar de branch. Desconectar e conectar novamente cria outro repositório. [Integração oficial](https://docs.lovable.dev/integrations/github).

Para este app, o caminho proposto é publicar primeiro uma cópia privada e depois levar os arquivos ao repositório criado pelo Lovable. Essa é uma migração manual, não uma função de importação. O repositório vinculado ao Lovable passa a ser a fonte de verdade; o primeiro pode permanecer como arquivo da entrega original.

## 1. Preparar e publicar o código privado

Use sua conta pessoal GitHub se deseja manter o acesso somente com você. Repositórios privados são visíveis ao proprietário e a quem receber acesso; em organizações também existem acessos administrativos. Ao conectar Lovable, você estará autorizando o serviço a acessar o código. [Visibilidade no GitHub](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories).

No PowerShell, entre na pasta:

```powershell
Set-Location -LiteralPath 'C:\Users\joseph\Documents\__BS Wallet'
git status
```

Se aparecer que não é um repositório Git, inicialize uma única vez:

```powershell
git init -b main
```

Revise o `.gitignore` e os arquivos que serão enviados. Não incluir `.env` com segredos, `node_modules`, build, comprovantes reais, backups financeiros, credenciais nem cópias do banco do navegador. `.env.example` pode ser versionado somente com valores de exemplo. O código do app não contém os dados que você digitou no IndexedDB.

Depois de revisar:

```powershell
git add .
git diff --cached --stat
git diff --cached
git commit -m "Cria BS Wallet offline"
```

Se Git pedir identidade, configure seu nome e o e-mail desejado para os commits. O GitHub oferece um [endereço `noreply` para commits](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address) para quem não deseja expor o e-mail pessoal. Os passos de inicialização e envio estão em [Adicionar código local ao GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github).

### Opção visual: GitHub Desktop

1. Entre na sua conta no GitHub Desktop.
2. Abra **File → Add local repository** e selecione esta pasta.
3. Clique em **Publish repository**. Nome sugerido: `bs-wallet-original`.
4. Mantenha **Keep this code private** marcado e publique na conta pessoal.
5. No GitHub, confirme o selo **Private** e revise quem tem acesso.

Referências: [adicionar pasta local](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-a-repository-from-your-local-computer-to-github-desktop) e [publicar pelo Desktop](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-an-existing-project-to-github-using-github-desktop).

### Opção pelo terminal: GitHub CLI

Se `gh` estiver instalado, autentique no navegador e publique:

```powershell
gh auth login
gh repo create bs-wallet-original --private --source . --remote origin --push
```

Execute a criação somente se o nome estiver disponível e esta cópia ainda não tiver `origin` configurado. Para um repositório já conectado, examine `git remote -v` e use o fluxo normal de `git push`; não remova um remoto que já guarda seu trabalho sem revisar. Consulte [gh repo create](https://cli.github.com/manual/gh_repo_create).

## 2. Conectar um projeto Lovable ao GitHub

1. Crie um projeto Lovable simples chamado BS Wallet, pedindo React, TypeScript e Vite, sem provisionar um backend.
2. Abra **Project settings → Git → GitHub → Add connection**. Autorize a instalação GitHub na sua conta.
3. Conecte o projeto à conta. Confira o repositório criado e o selo **Private**.
4. Anote o repositório e a branch ativa. Pare edições no Lovable durante a migração.

O caminho dos controles e o comportamento de sincronização estão descritos na [documentação da integração](https://docs.lovable.dev/integrations/github).

## 3. Levar o BS Wallet ao repositório conectado

Procedimento de engenharia proposto para contornar a limitação de importação:

1. Clone o repositório criado pelo Lovable em **outra pasta**, por exemplo `C:\Users\joseph\Documents\bs-wallet-lovable`, usando a URL mostrada no projeto.
2. No clone, crie uma branch `importar-bs-wallet`.
3. Copie os arquivos-fonte deste app para o clone: `src`, `public`, `docs`, testes, configurações, `index.html`, manifesto de dependências e lockfile. Revise arquivos iniciais do Lovable que conflitem com a aplicação copiada.
4. Preserve a pasta `.git` do clone e qualquer metadata necessária à conexão. Não copie `.git` da pasta original. Exclua da cópia dependências, build, arquivos locais secretos, relatórios temporários e dados financeiros.
5. Instale as dependências com o gerenciador indicado pelo lockfile e execute os comandos de validação do `package.json`/README.
6. Revise o diff, faça commit, envie a branch e abra um pull request para a branch conectada. Corrija eventuais conflitos e faça merge após a revisão.
7. Confirme o resultado no preview do Lovable: cadastro, lançamento, fechamento de cartão, temas, mobile e operação offline no build de produção. Confira também o estado da conexão.
8. Continue o trabalho a partir desse clone. Cadastre-o como projeto no Codex/VS Code. Assim os dois editores trabalham no mesmo repositório.

Não use `git push --force`, não substitua o histórico do repositório conectado e não copie a pasta original inteira por cima do clone. O procedimento preserva a conexão e permite revisar a migração antes do merge; a compatibilidade final precisa ser confirmada no preview da sua conta Lovable.

Dados financeiros já registrados permanecem no navegador e na origem onde foram criados. Trocar de URL não transfere o IndexedDB. Exporte um backup no app original e restaure-o na nova instalação quando essa função estiver disponível e validada; guarde o arquivo fora do Git.

## 4. Rotina entre Lovable e Codex

Distribuição proposta para o BS Wallet:

| Área | Responsável principal | Regra de revisão |
| --- | --- | --- |
| Layout, cores, tipografia, responsividade e componentes | Lovable | Validar desktop, mobile e acessibilidade |
| Regras financeiras, persistência, autenticação, permissões, sync e testes | Codex / VS Code | Testar domínio e revisar alterações antes do merge |
| Histórico, contratos e versão aceita | GitHub | Uma referência por versão entregue |
| Backend remoto | Xano via engenharia | Implantação explícita, conforme `XANO.md` |
| Referências visuais e tokens | Figma opcional | Não substituir o código aprovado automaticamente |

Antes de iniciar uma edição local, atualize a branch com `git pull --ff-only`. Trabalhe em uma branch por mudança e evite duas ferramentas alterando os mesmos arquivos ao mesmo tempo. Para ajustes visuais, escolha uma branch de UI no Lovable e faça a revisão por pull request. A branch principal deve continuar passando pelas validações do projeto.

Prompt sugerido para salvar nas instruções do projeto Lovable:

> O BS Wallet usa o GitHub conectado como referência do código. Trabalhe em apresentação, componentes, tokens, layout e UX. Preserve o domínio financeiro, persistência IndexedDB, autenticação, capabilities/scopes, auditoria, backups e testes. Não altere contratos ou regras de negócio como efeito colateral de uma mudança visual. Não substitua o backend por Supabase ou Lovable Cloud. A marca usa #008847, pt-BR e BRL. Valide também telas de 360 px, tema escuro, estado vazio, erro e offline. Qualquer mudança que exija engenharia deve ser descrita para revisão.

## 5. Código privado não significa aplicativo privado

Publicar o repositório apenas armazena o código; não hospeda automaticamente a aplicação. No Lovable, a publicação de sites nos planos Free e Pro permite acesso a quem tiver a URL. Business e Enterprise oferecem audiência restrita por workspace ou pessoas selecionadas. Configure **Who can view your site?** antes de publicar e confirme a audiência efetiva. Esses controles são independentes da visibilidade do repositório e das permissões internas do BS Wallet. [Publicação e acesso no Lovable](https://docs.lovable.dev/features/publish).

Para uso somente seu enquanto a nuvem não estiver pronta, mantenha o app local ou use hospedagem com controle de acesso adequado. Um formulário de login executado apenas no navegador não impede terceiros de baixar o código de um site público. GitHub privado também não substitui backup dos registros financeiros, autenticação do servidor ou autorização de acesso aos anexos.
