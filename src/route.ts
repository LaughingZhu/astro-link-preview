 // route.ts
 import type { APIRoute } from 'astro';
 import { context } from './context.js';
 import { chromium } from 'playwright'; // Use the package import
 
 const cache = new Map<string, Buffer>();
 const getBrowserInstance = async () => {
	 const config = context.get()
	 if (!config?.proxy) {
	 return await chromium.launch({   })
 }
		return await chromium.launch({
			// headless: 'new',
			 proxy: {
			 server: config.proxy,
		 },
	 });
 };
 
 
 //@ts-ignore
 export const get: APIRoute = async ({ params }) => {
	 const url = params.dynamic;
	 const config = context.get()
	const contentType = config?.imageFormat === 'jpg' ? 'image/jpeg' : 'image/png';
	 try {
		 if (cache.has(url)) {
		 return new Response(cache.get(url), {
			 status: 200,
				 statusText: 'OK',
				headers: {
					'Content-Type': contentType,
				},
		 });
	}
 
		 const rawHref = atob(url);
		 const browser = await getBrowserInstance();
		const page = await browser.newPage();
 
		 try {
			 await page.goto(rawHref, { waitUntil: 'networkidle' });
			}catch (error) {
			 console.error("Error while visiting URL:", error);
			 await page.close();
			await browser.close();
			return new Response(
			JSON.stringify({
			error: `Failed to goto url: ${rawHref}`,
		 }),
			 {
				status: 503,
					headers: {
					 'Content-Type': 'application/json',
				 },
			 }
		 )
		 }
 
		let buf;
		try {
				buf = await page.screenshot(
						config?.imageFormat === 'jpg'
							 ? {
								type: 'jpeg',
									quality: 75,
								}
						 : {
									type: 'png',
						 }
					 );
		 }catch (e) {
			console.error('Screenshot error', e);
				 await page.close();
					await browser.close();
			return new Response(
				 JSON.stringify({
					error: `Failed to take screenshot`,
					 }),
				{
				status: 503,
						 headers: {
							'Content-Type': 'application/json',
						},
				}
				 );
		}
 
		 if (buf.length === 0) {
			 await page.close();
				await browser.close();
		 return new Response(buf, {
				 status: 404,
				 headers: {
					 'Content-Type': contentType,
				 },
		 });
	}
 
 
		 cache.set(url, buf);
	 await page.close();
	 await browser.close();
	 return new Response(buf, {
			status: 200,
			statusText: 'OK',
			 headers: {
				'Content-Type': contentType,
				 'Cache-Control': 'public, max-age=31536000',
			},
		});
	} catch (e) {
			 console.error("error in api:", e)
	 return new Response(
			 JSON.stringify({
				 error: e.message,
			 }),
			 {
			 status: 503,
			 headers: {
				 'Content-Type': 'application/json',
				 },
			 }
		 );
	 }
 };