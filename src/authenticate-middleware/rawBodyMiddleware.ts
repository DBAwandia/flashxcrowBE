// middleware/rawBodyMiddleware.ts
import { Request, Response, NextFunction } from 'express';

export const rawBodyMiddleware = (req: any, res: Response, next: NextFunction) => {
  if (req.method === 'POST' && req.headers['content-type']?.includes('application/json')) {
    const chunks: Buffer[] = [];
    
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      // Store the EXACT raw bytes as string
      req.rawBody = Buffer.concat(chunks).toString('utf8');
      console.log('📥 Raw body captured successfully');
      console.log('📏 Raw body length:', req.rawBody.length);
      console.log('🔍 Raw body sample:', req.rawBody.substring(0, 100) + '...');
      next();
    });
  } else {
    next();
  }
};