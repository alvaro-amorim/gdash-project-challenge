# Deploy gratis recomendado

## Resumo rapido

Para colocar o app no ar sem custo recorrente, publique apenas estas partes:

- `frontend-react` no Vercel
- `backend-nestjs` no Render Free
- banco no MongoDB Atlas Free

Voce pode deixar `collector-python`, `worker-go` e `RabbitMQ` de fora nesse primeiro deploy. O dashboard principal continua funcionando porque usa:

- `POST /auth/request-login-code`
- `POST /auth/verify-login-code`
- `POST /auth/google`
- `GET /weather/live`
- `GET /weather/history`
- `GET /analytics/*`

## O que fica online de verdade

### Obrigatorio

- Frontend React
- Backend NestJS
- MongoDB

### Opcional

- Gemini para insights por IA
- Resend para login por email
- Google OAuth para login social

### Pode ficar para depois

- Worker em Go
- Coletor em Python
- RabbitMQ

## Limitacoes importantes

- O Render Free faz spin down quando o backend fica ocioso. O primeiro acesso depois de um tempo parado pode demorar.
- O Render Free bloqueia saida SMTP nas portas `25`, `465` e `587`. Por isso o backend agora suporta `RESEND_API_KEY` e `RESEND_FROM_EMAIL` via HTTP.
- Se voce quiser um caminho 100% gratis sem depender de dominio proprio para email, use Google login.
- Se voce quiser login por codigo em varios emails, o caminho mais simples e Resend. Para envio real a varios usuarios, normalmente voce precisa validar um dominio remetente.

## Stack sugerido

### Opcao mais pratica e realmente gratis

- Frontend: Vercel Hobby
- Backend: Render Free Web Service
- Banco: MongoDB Atlas M0
- Login: Google OAuth

### Opcao com codigo por email

- Frontend: Vercel Hobby
- Backend: Render Free Web Service
- Banco: MongoDB Atlas M0
- Email: Resend Free

## Passo 1. Subir o banco no MongoDB Atlas

1. Crie um cluster free no Atlas.
2. Crie um usuario de banco com login e senha.
3. Libere acesso de rede para o ambiente do deploy.
4. Copie a connection string no formato `mongodb+srv://...`.
5. Guarde esse valor para usar como `MONGO_URI` no Render.

## Passo 2. Subir o backend no Render

Voce pode importar o repositorio usando o arquivo [render.yaml](../render.yaml) que ja foi preparado.

### Se quiser configurar manualmente

- Service type: `Web Service`
- Runtime: `Node`
- Root Directory: `backend-nestjs`
- Build Command: `npm install && npm run build`
- Start Command: `npm run start:prod`

### Variaveis minimas no Render

- `MONGO_URI`
- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_NAME`

### Variaveis opcionais

- `GOOGLE_CLIENT_ID`
- `GEMINI_API_KEY`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

### Qual login escolher

- Google somente: configure `GOOGLE_CLIENT_ID` e pronto
- Email por codigo: configure `RESEND_API_KEY` e `RESEND_FROM_EMAIL`

Depois do deploy, anote a URL publica do backend, por exemplo:

```text
https://gdash-api.onrender.com
```

## Passo 3. Configurar Google login

Se voce quiser o caminho mais barato e simples, use Google login.

1. Crie um client Web no Google Cloud.
2. Adicione a URL do frontend publicado nas origens autorizadas.
3. Em desenvolvimento, mantenha `http://localhost:5173` nas origens tambem.
4. Salve o client id em `GOOGLE_CLIENT_ID` no backend.

O frontend ja consegue buscar esse client id no endpoint `/auth/public-config`, entao no Vercel o unico obrigatorio continua sendo `VITE_API_BASE_URL`.

## Passo 4. Subir o frontend no Vercel

O repositorio ja tem [vercel.json](../vercel.json) apontando para `frontend-react`.

### Variavel obrigatoria no Vercel

- `VITE_API_BASE_URL=https://sua-api-publica.onrender.com`

### Variavel opcional

- `VITE_GOOGLE_CLIENT_ID`

Essa variavel e opcional porque o frontend tambem consegue ler o client id publico do backend.

## Passo 5. Fazer o smoke test

Depois de publicar:

1. Abra o frontend no dominio do Vercel.
2. Verifique se o login Google aparece ou se o login por email mostra estado disponivel.
3. Entre no app.
4. Troque a cidade e confirme carregamento de `live` e `history`.
5. Abra `/api` no backend para checar o Swagger.

## O que eu recomendo para a sua primeira versao online

Para ir ao ar hoje, eu faria assim:

1. MongoDB Atlas Free
2. Backend no Render usando [render.yaml](../render.yaml)
3. Frontend no Vercel usando [vercel.json](../vercel.json)
4. Login Google como forma principal de acesso

Depois disso, se voce quiser muito o login por codigo, adicione Resend sem mudar a arquitetura.
