# Deploy VAIexpress API to Render (free tier)

## TL;DR
1) Pushโค้ดนี้ขึ้น GitHub/GitLab/Bitbucket  
2) เข้า Render > New > Web Service > เลือก repo  
3) Root directory: `.` | Build command: `npm install` | Start command: `npm start`  
4) ตั้ง Environment Variables:  
   - `PORT`: `10000` (Render จะ override เอง)  
   - ถ้าใช้ connection string: `DB_URL` เช่น `mysql://user:pass@host:3306/vaiexpress`  
     หรือใช้แบบแยก: `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`  
5) Deploy แล้วใช้ `https://<your-service>.onrender.com` เป็น API base (เช่น `/health`, `/api/orders`)

## รายละเอียด
- ใช้ `express` + `mysql2/promise` + `cors` + `dotenv`  
- รองรับ `DB_URL` (URI) หรือ host/user/pass/db  
- Health check: `GET /health` ต้องได้ 200 เพื่อให้ Render รู้ว่า service ตื่น
- CRUD:
  - `GET /api/orders?limit=50`
  - `GET /api/orders/:id`
  - `POST /api/orders`
  - `PUT /api/orders/:id`
  - `DELETE /api/orders/:id`
  - สรุป: `GET /api/stats/summary`

## ตั้งค่า Database
- Render ฟรีไม่มี MySQL ในตัว ให้ชี้ไปยัง MySQL ภายนอกที่เปิด public IP/SSL ได้ (เช่น PlanetScale free tier) หรือย้ายไปใช้ PostgreSQL แล้วปรับโค้ด
- ถ้าใช้ PlanetScale:  
  1) สร้าง DB  
  2) เปิด Branch/Password  
  3) ใช้ Connection string (สำหรับ `mysql2`) ใส่ที่ `DB_URL`

## หมายเหตุ
- อย่าลืมป้องกัน `.env` ไม่ให้ commit (เพิ่มใน `.gitignore`)  
- Render ฟรีอาจสลีปเมื่อ idle; หากต้องการ uptime คงที่พิจารณาแผน Pro
# ongza
logistic
