# GDASH Analytics

Plataforma full-stack de monitoramento climatico com frontend React, API NestJS, MongoDB, RabbitMQ, worker em Go e coletor em Python. O projeto combina consultas meteorologicas em tempo real, historico de 30 dias, insights por IA ou fallback local, autenticacao por codigo no email e painel administrativo de usuarios e visitas.

## Visao Geral

O sistema hoje atende dois fluxos principais:

- Painel interativo por cidade: cada usuario pode escolher uma cidade do Brasil, carregar o clima atual, consultar historico horario dos ultimos 30 dias e visualizar 3 insights rotativos.
- Pipeline orientada a eventos: o coletor busca dados climaticos, publica no RabbitMQ, o worker processa a fila e a API persiste os registros ingeridos no MongoDB.

## Principais Recursos

- Login por codigo enviado por email.
- Login com Google quando `GOOGLE_CLIENT_ID` estiver configurado.
- Seed automatica do usuario administrador com `ADMIN_EMAIL` e `ADMIN_NAME`.
- Perfil por usuario com cidade preferida, estado, latitude, longitude e timezone.
- Busca de cidades brasileiras via Open-Meteo Geocoding API.
- Clima atual por cidade com 3 insights por consulta.
- Rotacao automatica dos insights no card principal.
- Historico horario de ate 30 dias por cidade.
- Exportacao de dados em CSV e XLSX.
- Painel admin com usuarios cadastrados, visitas e usuarios ativos.
- Fallback local para insights quando a IA nao estiver configurada ou falhar.
- Fallback de login em desenvolvimento: se nenhum provedor de email estiver configurado, o backend retorna o codigo de acesso para uso local.

## Arquitetura

### Frontend

- `frontend-react`: React 19 + Vite + TypeScript.
- Dashboard com autenticacao, cidade por usuario, graficos em Recharts, perfil e admin.

### Backend

- `backend-nestjs`: API NestJS com MongoDB via Mongoose.
- Modulos principais:
  - `auth`: login por email, Google e perfil autenticado.
  - `users`: CRUD administrativo de usuarios.
  - `weather`: clima atual, historico, busca de cidades e exportacao.
  - `analytics`: visitas, heartbeat e overview admin.

### Pipeline

- `collector-python`: coleta clima e publica eventos.
- `worker-go`: consome a fila e envia para a API.
- `rabbitmq`: barramento de mensagens.
- `mongo`: persistencia principal.

## Stack

- React 19
- Vite
- TypeScript
- Tailwind CSS
- Recharts
- NestJS 11
- MongoDB
- RabbitMQ
- Python
- Go
- Docker Compose
- Open-Meteo
- Gemini API opcional

## Como Rodar Localmente

### 1. Criar o arquivo `.env`

Crie um arquivo `.env` na raiz do projeto usando [.env.example](./.env.example) como base. Exemplo:

```env
GEMINI_API_KEY=

RABBITMQ_DEFAULT_USER=admin
RABBITMQ_DEFAULT_PASS=password123
RABBIT_HOST=rabbitmq

MONGO_URI=mongodb://admin:password123@mongo:27017/gdash?authSource=admin

PORT=3000
TZ=America/Sao_Paulo
JWT_SECRET=troque_esta_chave
ADMIN_EMAIL=seu-email@exemplo.com
ADMIN_NAME=Seu Nome

GOOGLE_CLIENT_ID=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
VITE_API_BASE_URL=http://localhost:3000
VITE_GOOGLE_CLIENT_ID=

SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM_EMAIL=
```

### 2. Subir os servicos

```powershell
docker compose up -d --build
```

### 3. Acessar

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- Swagger: `http://localhost:3000/api`
- RabbitMQ Management: `http://localhost:15672`

## Reset Completo do Banco

Para apagar todos os dados e recriar o banco do zero:

```powershell
docker compose down -v --remove-orphans
docker compose up -d --build
```

Quando o backend iniciar novamente, ele recria automaticamente o admin definido em `ADMIN_EMAIL`.

## Fluxo de Login

### Email

1. O admin inicial e criado automaticamente com o email definido no `.env`.
2. O admin pode acessar o painel e criar novos usuarios.
3. Cada usuario entra informando o email e recebendo um codigo de 6 digitos.

Se nenhum provedor de email estiver configurado, o backend entra em fallback de desenvolvimento e retorna o codigo para login local.

### Provedores de email

- `RESEND_API_KEY` + `RESEND_FROM_EMAIL`: melhor opcao para hosts gratis que bloqueiam SMTP.
- `SMTP_HOST` + `SMTP_FROM_EMAIL`: continua suportado para ambientes que permitem saida SMTP.

### Google

O login Google e opcional. Para habilitar:

- configure `GOOGLE_CLIENT_ID` no backend e no frontend
- use um client web no Google Identity
- adicione `http://localhost:5173` nas origens autorizadas em desenvolvimento

Se `GOOGLE_CLIENT_ID` estiver vazio, o app continua funcionando normalmente sem esse botao.

## Insights e Clima

- O clima atual e consultado por cidade usando Open-Meteo.
- O historico usa dados horarios da API historica da Open-Meteo.
- A IA tenta gerar exatamente 3 insights por consulta.
- Esses 3 insights revezam automaticamente no card principal do dashboard.
- Se nao houver `GEMINI_API_KEY`, se a IA falhar, ou se nao existir usuario ativo, o sistema usa 3 insights de fallback coerentes com os dados atuais.

## Endpoints Principais

### Auth

- `POST /auth/request-login-code`
- `POST /auth/verify-login-code`
- `POST /auth/google`
- `GET /auth/me`
- `PATCH /auth/me`

### Usuarios

- `POST /users`
- `GET /users`
- `GET /users/:id`
- `DELETE /users/:id`

### Weather

- `GET /weather/cities?q=juiz`
- `GET /weather/live?...`
- `GET /weather/history?...`
- `GET /weather`
- `GET /weather/export/csv`
- `GET /weather/export/xlsx`
- `POST /weather`

### Analytics

- `GET /analytics/active-users`
- `POST /analytics/visits/start`
- `POST /analytics/visits/heartbeat`
- `POST /analytics/visits/end`
- `GET /analytics/overview`
- `GET /analytics/visits`

## Deploy Gratis Recomendado

Para publicar o app com o menor custo e a menor quantidade de infraestrutura, a recomendacao atual e:

- frontend no Vercel
- backend no Render Free
- banco no MongoDB Atlas Free
- login com Google como opcao mais simples

Se quiser o passo a passo completo, veja [docs/deploy-gratis.md](./docs/deploy-gratis.md).

## Deploy do Frontend no Vercel

O repositorio tem um `vercel.json` na raiz para fazer o deploy do frontend que esta dentro de `frontend-react`.

### Configuracao recomendada

- Root do projeto: raiz do repositorio
- Framework: Vite
- Variavel obrigatoria: `VITE_API_BASE_URL`

Exemplo:

```env
VITE_API_BASE_URL=https://seu-backend-publico.com
```

### Importante

- O Vercel publica apenas o frontend.
- O backend e o MongoDB precisam estar hospedados em outro ambiente.
- Para o deploy gratis inicial, `RabbitMQ`, `worker-go` e `collector-python` podem ficar de fora.
- Se `VITE_API_BASE_URL` nao apontar para uma API publica valida, o frontend sobe mas nao consegue autenticar nem carregar clima.

## Estrutura de Pastas

```text
.
|-- backend-nestjs
|-- collector-python
|-- frontend-react
|-- worker-go
|-- docker-compose.yml
|-- vercel.json
```

## Observacoes

- Para Gmail SMTP, use App Password em vez da senha normal da conta.
- O projeto funciona localmente mesmo sem SMTP e sem Gemini, usando os fallbacks descritos acima.
- O frontend foi pensado para consumo via JWT; o token e persistido localmente no navegador.
- O painel por cidade usa as rotas novas de `live` e `history`, enquanto a pipeline de ingestao continua disponivel para registros e exportacoes.
