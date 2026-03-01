import app from "./server";


const port = process.env.PORT ?? 3000


app.listen(port, (error) => {
    console.log(`Server running at http://localhost:${port}`)

    if (error) {
        console.log(error.message)
    }
})