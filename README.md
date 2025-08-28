# AI Diagnosis Auth Server

A secure Express.js server built with TypeScript, featuring user authentication and authorization using MongoDB and JWT tokens.

## Features

- 🔐 **JWT Authentication** - Secure token-based authentication
- 👥 **Role-based Authorization** - User and admin roles with different permissions
- 🛡️ **Security Middleware** - Helmet, CORS, rate limiting, and input validation
- 📊 **MongoDB Integration** - Mongoose ODM with proper indexing
- 🔒 **Password Hashing** - bcryptjs for secure password storage
- ✅ **Input Validation** - Express-validator for request validation
- 🚀 **TypeScript** - Full type safety and better development experience
- 📝 **Error Handling** - Centralized error handling with proper logging

## Prerequisites

- Node.js (v16 or higher)
- MongoDB (local or cloud instance)
- npm or yarn

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ai-diagnosis
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` file with your configuration:
   ```env
   PORT=3000
   NODE_ENV=development
   MONGODB_URI=mongodb://localhost:27017/ai-diagnosis-auth
   JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
   JWT_EXPIRES_IN=7d
   ```

4. **Start MongoDB**
   Make sure MongoDB is running on your system or use a cloud instance.

## Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

The server will start on `http://localhost:3000`

## API Endpoints

### Authentication Routes

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123",
  "firstName": "John",
  "lastName": "Doe"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123"
}
```

#### Get Profile
```http
GET /api/auth/profile
Authorization: Bearer <jwt-token>
```

#### Logout
```http
POST /api/auth/logout
Authorization: Bearer <jwt-token>
```

### User Management Routes (Admin Only)

#### Get All Users
```http
GET /api/users?page=1&limit=10
Authorization: Bearer <jwt-token>
```

#### Get User by ID
```http
GET /api/users/:id
Authorization: Bearer <jwt-token>
```

#### Update User
```http
PUT /api/users/:id
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "firstName": "Updated Name",
  "role": "admin"
}
```

#### Delete User
```http
DELETE /api/users/:id
Authorization: Bearer <jwt-token>
```

### User Profile Routes

#### Update Profile
```http
PUT /api/users/profile
Authorization: Bearer <jwt-token>
Content-Type: application/json

{
  "firstName": "New Name",
  "password": "NewSecurePass123"
}
```

## Response Format

All API responses follow a consistent format:

### Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": {
    // Response data
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message",
  "errors": [
    {
      "field": "email",
      "message": "Please provide a valid email"
    }
  ]
}
```

## Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Authorization

The system supports two roles:

- **user**: Can access their own profile and update it
- **admin**: Can access all user management endpoints

## Security Features

- **Password Requirements**: Minimum 6 characters with uppercase, lowercase, and number
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Input Validation**: All inputs are validated and sanitized
- **CORS Protection**: Configurable CORS settings
- **Helmet**: Security headers
- **JWT Expiration**: Configurable token expiration

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment | development |
| `MONGODB_URI` | MongoDB connection string | mongodb://localhost:27017/ai-diagnosis-auth |
| `JWT_SECRET` | JWT signing secret | - |
| `JWT_EXPIRES_IN` | JWT expiration time | 7d |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | 900000 |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | 100 |
| `CORS_ORIGIN` | CORS allowed origin | http://localhost:3000 |

## Development

### Project Structure
```
src/
├── config/
│   └── database.ts
├── controllers/
│   ├── authController.ts
│   └── userController.ts
├── middleware/
│   ├── auth.ts
│   ├── errorHandler.ts
│   └── validation.ts
├── models/
│   └── User.ts
├── routes/
│   ├── auth.ts
│   └── user.ts
└── index.ts
```

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run tests

## Testing

```bash
npm test
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Use a strong `JWT_SECRET`
3. Configure MongoDB connection string
4. Set up proper CORS origins
5. Use environment-specific rate limiting

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License
