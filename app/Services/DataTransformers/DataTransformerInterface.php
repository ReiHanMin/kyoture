<?php

namespace App\Services\DataTransformers;

interface DataTransformerInterface
{
    /**
     * Transform raw event data into a standardized format.
     *
     * @param array $eventData
     * @return array|null
     */
    public function transform(array $eventData): ?array;
}
