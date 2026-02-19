import app from "./server";
import 'dotenv/config'

const port = process.env.PORT


app.listen(port, (error) => {
    console.log(`Server running at http://localhost:${port}`)

    if (error) {
        console.log(error.message)
    }
})