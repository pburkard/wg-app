# WG Manager

A free, open source app for managing shared apartments (Wohngemeinschaften). Coordinate cleaning schedules, track shared expenses, and settle debts with your flatmates — all in one place.

Available on **iOS**, **Android**, and **Web** from a single codebase.

## Features

- 🧹 **Cleaning schedule** with automatic weekly rotation
- 💸 **Shared expense tracking** with equal or custom splits
- ⚖️ **Balance overview** — see who owes whom at a glance
- 🔔 **Push notifications** for cleaning duties and new expenses
- 👥 **Easy onboarding** via invite codes
- 🌐 **Cross-platform** — iOS, Android, Web

## Tech Stack

- **Frontend:** [Expo](https://expo.dev) (React Native + Web) + TypeScript
- **Backend:** [Supabase](https://supabase.com) (Postgres, Auth, Edge Functions)
- **Notifications:** Expo Push Notifications

## Getting Started

### Prerequisites

- Node.js 22.x LTS or newer
- npm or pnpm
- A free [Supabase](https://supabase.com) account
- [Expo Go](https://expo.dev/go) on your phone (for development)

### Setup

```bash
# Clone the repo
git clone https://github.com/<your-username>/wg-manager.git
cd wg-manager

# Install dependencies
npm install

# Copy env template and fill in your Supabase credentials
cp .env.example .env

# Start the dev server
npx expo start
```

Scan the QR code with Expo Go on your phone, or press `w` to open in the browser.

### Database Setup

Apply the schema migration to your Supabase project:

```bash
# Using the Supabase CLI
supabase db push

# Or manually: paste supabase/migrations/00001_initial_schema.sql
# into the SQL Editor in your Supabase dashboard
```

## Project Structure

```
wg-manager/
├── app/                    # Expo Router screens
├── components/             # Reusable UI components
├── lib/                    # Supabase client, helpers
├── supabase/
│   ├── migrations/         # SQL schema migrations
│   └── functions/          # Edge Functions (Deno/TS)
├── SPEC.md                 # Full product specification
└── README.md
```

## Contributing

Contributions are welcome! Please open an issue first to discuss any major changes.

## License

[MIT](LICENSE) — free to use, modify, and distribute.
