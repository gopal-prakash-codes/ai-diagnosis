import multer from "multer";
import path from "path";

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webm"; // fallback if no extension
    cb(null, file.fieldname + "-" + Date.now() + ext);
  },
});

export const upload = multer({ storage });