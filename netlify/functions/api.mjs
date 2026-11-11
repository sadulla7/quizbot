// Admin panel API: /api/auth/*, /api/admin/*, /api/img/*
import { handleApi } from '../../src/api/admin.mjs';

export default async (req) => handleApi(req, { origin: new URL(req.url).origin });

export const config = { path: ['/api/auth/*', '/api/admin/*', '/api/img/*'] };
