import { HttpCode } from "../constants";
import { AppError } from "../cores/errors/custom.error";
import { type ErrorResponse } from "../types";
import { NextFunction, Request, Response } from "express";

export class ErrorMiddleware {
    public static handleError = (
        error: unknown,
        _: Request,
        res: Response<ErrorResponse>,
        next: NextFunction
    ): void => {
        if (error instanceof AppError) {
            const { name, message, formattedStack, validationErrors } = error;
            const statusCode = error.statusCode || HttpCode.INTERNAL_SERVER_ERROR;

            res.statusCode = statusCode;

            res.json({
                name,
                message,
                validationErrors,
                stack: formattedStack
            })
        } else {
            const name = "InternalServerError";
            const message = "An internal server error occured"
            const statusCode = HttpCode.INTERNAL_SERVER_ERROR;

            res.statusCode = statusCode;
            res.json({ name, message })
        }

        next();
    };
}